import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import {
  ImporterAgent,
  type SettlementReconciliationRecord
} from "../src/importer-agent.js";
import { getMockExportDocuments } from "../src/mock-exporter.js";
import { PaymentReservationStore, type PaymentRecord } from "../src/payment/policy.js";
import type { PaymentDispatchAwareFetch } from "../src/payment/client.js";
import { validDutyQuote } from "./fixtures.js";

const importerAddress = "0x1111111111111111111111111111111111111111";
const brokerAddress = "0x2222222222222222222222222222222222222222";
const network = "eip155:84532";

const quoteId = validDutyQuote.quoteId;
const quote = validDutyQuote;

const successfulSettlement: SettleResponse = {
  success: true,
  transaction: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  network,
  payer: importerAddress,
  amount: "10000"
};

function freeQuoteFetch(onCall?: () => void, quoted = quote): typeof globalThis.fetch {
  return async () => {
    onCall?.();
    return new Response(JSON.stringify({ quote: quoted }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function withDispatchTracking(
  fetch: typeof globalThis.fetch,
  dispatched = true
): PaymentDispatchAwareFetch {
  return Object.assign(fetch, { getPaymentDispatchState: () => dispatched });
}

function fakePaidFetch(
  onCall?: () => void,
  status = 200,
  settlementHeader: string | null = encodePaymentResponseHeader(successfulSettlement),
  paidBrokerAddress = brokerAddress,
  quoted = quote,
  paidBrokerFeeUsd = 0.01
): PaymentDispatchAwareFetch {
  return withDispatchTracking(async () => {
    onCall?.();
    const headers = new Headers({ "content-type": "application/json" });
    if (settlementHeader !== null) headers.set("payment-response", settlementHeader);
    return new Response(JSON.stringify({
      quote: quoted,
      receipt: {
        receiptId: "CBR-TEST",
        declarationId: quoted.declarationId,
        brokerFeeUsd: paidBrokerFeeUsd,
        brokerAddress: paidBrokerAddress,
        status: "filed",
        timestamp: new Date().toISOString()
      }
    }), { status, headers });
  });
}

function createAgent(
  policy = {
    maxPaymentUsd: 1,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0,
  },
  paidFetch = fakePaidFetch(),
  quoteFetch = freeQuoteFetch(),
  brokerFeeUsd = 0.01
) {
  return new ImporterAgent(
    "http://broker.test",
    policy,
    quoteFetch,
    paidFetch,
    brokerFeeUsd,
    brokerAddress,
    importerAddress,
  );
}

async function precheckAndQuote(agent: ImporterAgent, orderId: string) {
  const preflight = agent.precheck(orderId, getMockExportDocuments(orderId));
  return agent.getQuote(preflight.preflightId, true);
}

function retryingPaidFetch(firstSettlementHeader: string | null, firstStatus = 200): PaymentDispatchAwareFetch {
  let firstAttempt = true;
  return withDispatchTracking(async () => {
    const settlementHeader = firstAttempt
      ? firstSettlementHeader
      : encodePaymentResponseHeader(successfulSettlement);
    const status = firstAttempt ? firstStatus : 200;
    firstAttempt = false;
    return fakePaidFetch(undefined, status, settlementHeader)("http://broker.test");
  });
}

async function assertInvalidSettlementCanRetry(
  orderId: string,
  firstSettlementHeader: string | null,
  errorPattern: RegExp,
  firstStatus = 200
) {
  const agent = createAgent(undefined, retryingPaidFetch(firstSettlementHeader, firstStatus));
  await precheckAndQuote(agent, orderId);
  await assert.rejects(() => agent.submit(orderId, quoteId, true), errorPattern);

  const result = await agent.submit(orderId, quoteId, true);
  assert.deepEqual(result.settlement, successfulSettlement);
}

async function assertInvalidSettlementBlocksRetry(
  orderId: string,
  firstSettlementHeader: string | null,
  errorPattern: RegExp,
  firstStatus = 200
) {
  const agent = createAgent(undefined, retryingPaidFetch(firstSettlementHeader, firstStatus));
  await precheckAndQuote(agent, orderId);
  await assert.rejects(() => agent.submit(orderId, quoteId, true), errorPattern);
  await assert.rejects(
    () => agent.submit(orderId, quoteId, true),
    /requires reconciliation/
  );
  assert.equal(agent.getSettlementReconciliation(quoteId)?.state, "ambiguous");
}

test("precheck estimates costs without calling the broker", () => {
  let brokerCalled = false;
  const result = createAgent(
    undefined,
    undefined,
    freeQuoteFetch(() => {
      brokerCalled = true;
    }),
  ).precheck("TEST-PREFLIGHT", getMockExportDocuments("TEST-PREFLIGHT"));
  assert.equal(result.readyForBroker, true);
  assert.equal(result.transmittedToBroker, false);
  assert.equal(result.independentEstimate?.estimatedTotalUsd, 2_908.94);
  assert.equal(brokerCalled, false);
});

test("quote is returned without calling the paid fetch", async () => {
  let paid = false;
  const result = await precheckAndQuote(
    createAgent(
      undefined,
      fakePaidFetch(() => {
        paid = true;
      }),
    ),
    "TEST-001",
  );
  assert.ok(result.quote);
  assert.equal(result.quote.quoteId, quoteId);
  assert.equal(result.quote.totalEstimatedUsd, 2_908.94);
  assert.equal(paid, false);
});

test("approved declaration uses the quote and paid fetch", async () => {
  const agent = createAgent();
  await precheckAndQuote(agent, "TEST-001");
  const result = await agent.submit("TEST-001", quoteId, true);
  assert.ok(result.quote);
  assert.equal(result.receipt.status, "filed");
  assert.equal(result.quote.quoteId, quoteId);
});

test("serializes concurrent submissions so a quote is paid only once", async () => {
  let paidCalls = 0;
  let notifyPaymentStarted: () => void = () => {};
  let releasePayment: () => void = () => {};
  const paymentStarted = new Promise<void>((resolve) => {
    notifyPaymentStarted = resolve;
  });
  const paymentReleased = new Promise<void>((resolve) => {
    releasePayment = resolve;
  });
  const paidFetch = withDispatchTracking(async () => {
    paidCalls += 1;
    notifyPaymentStarted();
    await paymentReleased;
    return fakePaidFetch()("http://broker.test");
  });
  const agent = createAgent(undefined, paidFetch);
  await precheckAndQuote(agent, "TEST-CONCURRENT");

  const first = agent.submit("TEST-CONCURRENT", quoteId, true);
  await paymentStarted;
  const second = agent.submit("TEST-CONCURRENT", quoteId, true);
  releasePayment();

  const results = await Promise.allSettled([first, second]);
  assert.equal(paidCalls, 1);
  assert.equal(results[0]?.status, "fulfilled");
  assert.equal(results[1]?.status, "rejected");
  assert.match(
    String((results[1] as PromiseRejectedResult).reason),
    /matching reviewed broker quote/i,
  );
});

test("payment policy blocks unapproved submission", async () => {
  const agent = createAgent();
  await precheckAndQuote(agent, "TEST-002");
  await assert.rejects(
    () => agent.submit("TEST-002", quoteId, false),
    /HUMAN_APPROVAL_REQUIRED/,
  );
});

test("hard spending limit blocks payment even when approved", async () => {
  const agent = createAgent({
    maxPaymentUsd: 0.005,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0,
  });
  await precheckAndQuote(agent, "TEST-003");
  await assert.rejects(
    () => agent.submit("TEST-003", quoteId, true),
    /PER_PAYMENT_LIMIT_EXCEEDED/,
  );
});

test("shared in-flight policy reservation limits concurrent dispatches", async () => {
  const quoteA = { ...quote, quoteId: "QUOTE-A", declarationId: "DECL-A" };
  const quoteB = { ...quote, quoteId: "QUOTE-B", declarationId: "DECL-B" };
  const history: PaymentRecord[] = [];
  const reservationStore = new PaymentReservationStore();
  const policy = {
    maxPaymentUsd: 1,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0,
    maxPaymentsPerHour: 1
  };
  const preflightStoreA = new Map();
  const quoteStoreA = new Map();
  const preflightStoreB = new Map();
  const quoteStoreB = new Map();
  let dispatches = 0;
  let releaseFirst!: () => void;
  const firstSettled = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstDispatched!: () => void;
  const dispatched = new Promise<void>(resolve => { firstDispatched = resolve; });
  const agentA = new ImporterAgent(
    "http://broker.test",
    policy,
    freeQuoteFetch(undefined, quoteA),
    withDispatchTracking(async (input, init) => {
      dispatches += 1;
      firstDispatched();
      await firstSettled;
      return fakePaidFetch(undefined, 200, undefined, brokerAddress, quoteA)(input, init);
    }),
    0.01,
    brokerAddress,
    importerAddress,
    preflightStoreA,
    quoteStoreA,
    history,
    network,
    new Map(),
    reservationStore
  );
  const agentB = new ImporterAgent(
    "http://broker.test",
    policy,
    freeQuoteFetch(undefined, quoteB),
    withDispatchTracking(async (input, init) => {
      dispatches += 1;
      return fakePaidFetch(undefined, 200, undefined, brokerAddress, quoteB)(input, init);
    }),
    0.01,
    brokerAddress,
    importerAddress,
    preflightStoreB,
    quoteStoreB,
    history,
    network,
    new Map(),
    reservationStore
  );
  await precheckAndQuote(agentA, "TEST-CONCURRENT-A");
  await precheckAndQuote(agentB, "TEST-CONCURRENT-B");
  const first = agentA.submit("TEST-CONCURRENT-A", quoteA.quoteId, true);
  await dispatched;
  await assert.rejects(
    () => agentB.submit("TEST-CONCURRENT-B", quoteB.quoteId, true),
    /HOURLY_PAYMENT_COUNT_EXCEEDED/
  );
  releaseFirst();
  const result = await first;
  assert.equal(result.quote.quoteId, quoteA.quoteId);
  assert.equal(dispatches, 1);
  assert.equal(history.length, 1);
});

test("shared reservation rejects concurrent submissions for the same quote", async () => {
  const reservationStore = new PaymentReservationStore();
  const preflightStore = new Map();
  const quoteStore = new Map();
  const paymentHistory: PaymentRecord[] = [];
  let paidFetchCalls = 0;
  let releaseFirst!: () => void;
  const firstSettled = new Promise<void>(resolve => { releaseFirst = resolve; });
  let firstStarted!: () => void;
  const firstStartedPromise = new Promise<void>(resolve => { firstStarted = resolve; });
  const paidFetch = withDispatchTracking(async (input, init) => {
    paidFetchCalls += 1;
    firstStarted();
    await firstSettled;
    return fakePaidFetch()(input, init);
  });
  const createSharedAgent = () => new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    paidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    paymentHistory,
    network,
    new Map(),
    reservationStore
  );
  const firstAgent = createSharedAgent();
  const secondAgent = createSharedAgent();
  await precheckAndQuote(firstAgent, "TEST-SAME-QUOTE-CONCURRENT");

  const first = firstAgent.submit("TEST-SAME-QUOTE-CONCURRENT", quoteId, true);
  await firstStartedPromise;
  await assert.rejects(
    () => secondAgent.submit("TEST-SAME-QUOTE-CONCURRENT", quoteId, true),
    /PAYMENT_ALREADY_IN_FLIGHT/
  );
  releaseFirst();

  const result = await first;
  assert.equal(result.quote.quoteId, quoteId);
  assert.equal(paidFetchCalls, 1);
  assert.equal(reservationStore.get(result.paymentPolicyDecision.auditId), undefined);
});

test("reconciliation write collisions do not leave an active reservation", async () => {
  class RecordingReservationStore extends PaymentReservationStore {
    readonly heldReservationIds: string[] = [];

    override holdAmbiguous(reservationId: string): void {
      this.heldReservationIds.push(reservationId);
      super.holdAmbiguous(reservationId);
    }
  }

  const preflightStore = new Map();
  const quoteStore = new Map();
  const history: PaymentRecord[] = [];
  const settlementPending = new Map<string, SettlementReconciliationRecord>();
  const reservationStoreA = new RecordingReservationStore();
  const reservationStoreB = new RecordingReservationStore();
  let fetchesStarted = 0;
  let releaseResponses!: () => void;
  const responsesReleased = new Promise<void>(resolve => { releaseResponses = resolve; });
  let bothFetchesStarted!: () => void;
  const bothFetchesStartedPromise = new Promise<void>(resolve => { bothFetchesStarted = resolve; });
  const uncertainPaidFetch = withDispatchTracking(async () => {
    fetchesStarted += 1;
    if (fetchesStarted === 2) bothFetchesStarted();
    await responsesReleased;
    return new Response("gateway failure", { status: 402 });
  });
  const policy = {
    maxPaymentUsd: 1,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0,
    maxPaymentsPerHour: 2
  };
  const agentA = new ImporterAgent(
    "http://broker.test",
    policy,
    freeQuoteFetch(),
    uncertainPaidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    history,
    network,
    settlementPending,
    reservationStoreA
  );
  const agentB = new ImporterAgent(
    "http://broker.test",
    policy,
    freeQuoteFetch(),
    uncertainPaidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    history,
    network,
    settlementPending,
    reservationStoreB
  );
  await precheckAndQuote(agentA, "TEST-RECONCILIATION-COLLISION");

  const first = agentA.submit("TEST-RECONCILIATION-COLLISION", quoteId, true);
  const second = agentB.submit("TEST-RECONCILIATION-COLLISION", quoteId, true);
  await bothFetchesStartedPromise;
  releaseResponses();
  const outcomes = await Promise.allSettled([first, second]);

  assert.equal(outcomes.every(outcome => outcome.status === "rejected"), true);
  assert.equal(settlementPending.size, 1);
  const reconciliation = [...settlementPending.values()][0];
  assert.ok(reconciliation);
  assert.deepEqual(
    new Set(reconciliation.reservationIds ?? []),
    new Set([
      reservationStoreA.heldReservationIds[0],
      reservationStoreB.heldReservationIds[0]
    ])
  );
  assert.equal(reservationStoreA.heldReservationIds.length, 1);
  assert.equal(reservationStoreB.heldReservationIds.length, 1);
  assert.equal(
    reservationStoreA.get(reservationStoreA.heldReservationIds[0]!)?.state,
    "ambiguous"
  );
  assert.equal(
    reservationStoreB.get(reservationStoreB.heldReservationIds[0]!)?.state,
    "ambiguous"
  );
});

test("importer and customs broker may use the same address", async () => {
  const agent = new ImporterAgent(
    "http://broker.test",
    {
      maxPaymentUsd: 1,
      allowedPayees: [importerAddress],
      requireHumanApprovalAboveUsd: 0,
    },
    freeQuoteFetch(),
    fakePaidFetch(undefined, 200, undefined, importerAddress),
    0.01,
    importerAddress,
    importerAddress,
  );
  await precheckAndQuote(agent, "TEST-SAME");
  const result = await agent.submit("TEST-SAME", quoteId, true);
  assert.equal(result.receipt.status, "filed");
  assert.equal(result.receipt.brokerAddress, importerAddress);
});

test("rejects a receipt from a different broker address", async () => {
  const unexpectedBroker = "0x3333333333333333333333333333333333333333";
  const agent = createAgent(
    undefined,
    fakePaidFetch(undefined, 200, undefined, unexpectedBroker),
  );
  await precheckAndQuote(agent, "TEST-WRONG-BROKER");

  await assert.rejects(
    () => agent.submit("TEST-WRONG-BROKER", quoteId, true),
    /receipt address does not match the approved payee/i,
  );
});

test("quote compares broker fees with the independent importer estimate", async () => {
  const result = await precheckAndQuote(createAgent(), "TEST-REVIEW");
  assert.ok(result.complianceReview);
  assert.equal(result.complianceReview.paymentAllowed, true);
  assert.equal(
    result.independentEstimate.estimatedTotalUsd,
    result.quote.totalEstimatedUsd,
  );
  assert.equal(result.complianceReview.tariffLookupRequired, true);
  assert.ok(
    result.complianceReview.missingInformation.includes(
      "Taiwan import permit or competent-authority approval when applicable",
    ),
  );
});

test("submission requires a matching reviewed quote", async () => {
  await assert.rejects(
    () => createAgent().submit("TEST-NO-REVIEW", quoteId, true),
    /matching reviewed broker quote/i,
  );
});

test("submission rechecks quote expiration immediately before payment", async () => {
  const expiredQuote = {
    ...quote,
    expiresAt: new Date(Date.now() - 1_000).toISOString(),
  };
  const agent = createAgent(
    undefined,
    undefined,
    async () =>
      new Response(JSON.stringify({ quote: expiredQuote }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  const preflight = agent.precheck(
    "TEST-EXPIRED",
    getMockExportDocuments("TEST-EXPIRED"),
  );
  const result = await agent.getQuote(preflight.preflightId, true);
  assert.equal(result.complianceReview.paymentAllowed, false);
  await assert.rejects(
    () => agent.submit("TEST-EXPIRED", quoteId, true),
    /comparison blocked payment/,
  );
});

test("slow settlement returns the post-payment compliance review after quote expiry", async () => {
  const expiringQuote = {
    ...quote,
    expiresAt: new Date(Date.now() + 300).toISOString()
  };
  const paidFetch = withDispatchTracking(async (input, init) => {
    await new Promise(resolve => setTimeout(resolve, 500));
    return fakePaidFetch(
      undefined,
      200,
      encodePaymentResponseHeader(successfulSettlement),
      brokerAddress,
      expiringQuote
    )(input, init);
  });
  const agent = createAgent(
    undefined,
    paidFetch,
    freeQuoteFetch(undefined, expiringQuote)
  );
  await precheckAndQuote(agent, "TEST-SLOW-SETTLEMENT");
  const result = await agent.submit("TEST-SLOW-SETTLEMENT", quoteId, true);
  assert.equal(result.settlement.transaction, successfulSettlement.transaction);
  assert.equal(result.complianceReview.paymentAllowed, false);
});

test("missing required documents are blocked before broker transmission", async () => {
  let brokerCalled = false;
  const agent = createAgent(
    undefined,
    undefined,
    freeQuoteFetch(() => {
      brokerCalled = true;
    }),
  );
  const result = agent.precheck(
    "TEST-MISSING",
    getMockExportDocuments("TEST-MISSING", ["commercial_invoice"]),
  );
  assert.equal(result.documentReview.readyToTransmit, false);
  assert.equal(result.transmittedToBroker, false);
  assert.equal(brokerCalled, false);
  assert.deepEqual(result.documentReview.missingRequiredDocuments.sort(), [
    "bill_of_lading",
    "digital_product_passport",
    "packing_list",
  ]);
});

test("validates DPP and classifies the product as low carbon before transmission", () => {
  const result = createAgent().precheck(
    "TEST-DPP",
    getMockExportDocuments("TEST-DPP"),
  );

  assert.equal(result.readyForBroker, true);
  assert.equal(result.documentReview.lowCarbonAssessment.documentValid, true);
  assert.equal(
    result.documentReview.lowCarbonAssessment.qualifiesAsLowCarbonProduct,
    true,
  );
  assert.equal(
    result.documentReview.lowCarbonAssessment.calculatedReductionPercent,
    28,
  );
});

test("blocks an inconsistent DPP before customs transmission", () => {
  let brokerCalled = false;
  const documents = getMockExportDocuments("TEST-DPP-MISMATCH");
  documents.digitalProductPassport!.carbonFootprint.claimedReductionPercent = 40;
  const result = createAgent(
    undefined,
    undefined,
    freeQuoteFetch(() => {
      brokerCalled = true;
    }),
  ).precheck("TEST-DPP-MISMATCH", documents);

  assert.equal(result.readyForBroker, false);
  assert.equal(brokerCalled, false);
  assert.ok(
    result.documentReview.findings.some(
      (finding) => finding.code === "DPP_CARBON_REDUCTION_MISMATCH",
    ),
  );
});

test("submits the validated DPP and low-carbon decision at customs filing", async () => {
  let submittedBody: unknown;
  const paidFetch = withDispatchTracking(async (_input, init) => {
    submittedBody = JSON.parse(String(init?.body));
    return fakePaidFetch()("http://broker.test");
  });
  const agent = createAgent(undefined, paidFetch);
  await precheckAndQuote(agent, "TEST-DPP-SUBMIT");
  await agent.submit("TEST-DPP-SUBMIT", quoteId, true);

  const body = submittedBody as {
    documents: ReturnType<typeof getMockExportDocuments>;
    documentReview: {
      lowCarbonAssessment: { qualifiesAsLowCarbonProduct: boolean };
    };
  };
  assert.ok(body.documents.digitalProductPassport);
  assert.equal(
    body.documentReview.lowCarbonAssessment.qualifiesAsLowCarbonProduct,
    true,
  );
});

test("invalid invoice and packing values are blocked before broker transmission", async () => {
  let brokerCalled = false;
  const agent = createAgent(
    undefined,
    undefined,
    freeQuoteFetch(() => {
      brokerCalled = true;
    }),
  );
  const documents = getMockExportDocuments("TEST-INVALID-NUMBERS");
  documents.items[0]!.quantity = -1;
  documents.grossWeightKg = 400;
  documents.netWeightKg = 420;

  const result = agent.precheck("TEST-INVALID-NUMBERS", documents);

  assert.equal(result.readyForBroker, false);
  assert.equal(result.independentEstimate, undefined);
  assert.equal(brokerCalled, false);
  assert.ok(
    result.documentReview.findings.some(
      (finding) => finding.code === "COMMERCIAL_INVOICE_INCOMPLETE",
    ),
  );
  assert.ok(
    result.documentReview.findings.some(
      (finding) => finding.code === "PACKING_LIST_INCOMPLETE",
    ),
  );
});

test("broker quote requires explicit estimate confirmation", async () => {
  let brokerCalled = false;
  const agent = createAgent(
    undefined,
    undefined,
    freeQuoteFetch(() => {
      brokerCalled = true;
    }),
  );
  const preflight = agent.precheck(
    "TEST-NO-CONFIRM",
    getMockExportDocuments("TEST-NO-CONFIRM"),
  );
  await assert.rejects(
    () => agent.getQuote(preflight.preflightId, false),
    /must confirm/,
  );
  assert.equal(brokerCalled, false);
});

test("malformed broker quotes are rejected before entering the quote store", async () => {
  const malformedQuotes = [
    { ...quote, dutyUsd: -1 },
    { ...quote, tariffBasis: "untrusted-tariff" },
    { ...quote, expiresAt: "not-a-date" },
    { ...quote, quoteId: "" },
    { ...quote, goodsValueUsd: "1200" }
  ];

  for (const [index, malformedQuote] of malformedQuotes.entries()) {
    const quoteStore = new Map();
    const agent = new ImporterAgent(
      "http://broker.test",
      { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
      async () => new Response(JSON.stringify({ quote: malformedQuote }), {
        status: 200,
        headers: { "content-type": "application/json" }
      }),
      fakePaidFetch(),
      0.01,
      brokerAddress,
      importerAddress,
      new Map(),
      quoteStore
    );
    const orderId = `TEST-MALFORMED-QUOTE-${index}`;
    const preflight = agent.precheck(orderId, getMockExportDocuments(orderId));
    await assert.rejects(
      () => agent.getQuote(preflight.preflightId, true),
      /Customs broker quote is invalid/
    );
    assert.equal(quoteStore.size, 0);
  }
});

test("paid 2xx response requires a settlement header and preserves the quote", async () => {
  await assertInvalidSettlementBlocksRetry(
    "TEST-MISSING-SETTLEMENT",
    null,
    /missing PAYMENT-RESPONSE settlement header/
  );
});

test("paid 2xx response rejects malformed settlement headers and preserves the quote", async () => {
  await assertInvalidSettlementBlocksRetry(
    "TEST-MALFORMED-SETTLEMENT",
    "not-base64",
    /Invalid PAYMENT-RESPONSE settlement header/
  );
});

test("paid 2xx response rejects unsuccessful settlements and preserves the quote", async () => {
  const settlement = { ...successfulSettlement, success: false, errorReason: "INSUFFICIENT_FUNDS" };
  await assertInvalidSettlementBlocksRetry(
    "TEST-FAILED-SETTLEMENT",
    encodePaymentResponseHeader(settlement),
    /settlement was not successful: INSUFFICIENT_FUNDS/
  );
});

test("paid 2xx response rejects settlement mismatches and preserves the quote", async () => {
  const cases: Array<[string, Partial<SettleResponse>, RegExp]> = [
    ["wrong network", { network: "eip155:1" }, /settlement network/],
    ["empty transaction", { transaction: "" }, /settlement transaction is required/],
    ["malformed transaction", { transaction: "0x1234" }, /non-zero 32-byte hash/],
    [
      "zero transaction",
      { transaction: `0x${"0".repeat(64)}` },
      /non-zero 32-byte hash/
    ],
    ["wrong payer", { payer: brokerAddress }, /settlement payer does not match/],
    ["wrong amount", { amount: "10001" }, /settlement amount 10001 does not match/]
  ];
  for (const [label, override, errorPattern] of cases) {
    const orderId = `TEST-${label.replaceAll(" ", "-")}`;
    await assertInvalidSettlementBlocksRetry(
      orderId,
      encodePaymentResponseHeader({ ...successfulSettlement, ...override }),
      errorPattern
    );
  }
});

test("non-2xx settlement responses preserve the quote for a valid retry", async () => {
  const failedSettlement: SettleResponse = {
    success: false,
    errorReason: "SETTLEMENT_FAILED",
    transaction: successfulSettlement.transaction,
    network,
    payer: importerAddress
  };
  await assertInvalidSettlementCanRetry(
    "TEST-NON-2XX-SETTLEMENT",
    encodePaymentResponseHeader(failedSettlement),
    /SETTLEMENT_FAILED/,
    402
  );
});

test("non-2xx errors include bounded body diagnostics and accept the legacy settlement header", async () => {
  const failedSettlement: SettleResponse = {
    success: false,
    errorReason: "SETTLEMENT_FAILED",
    transaction: successfulSettlement.transaction,
    network,
    payer: importerAddress
  };
  const responseBody = `${"a".repeat(520)}TAIL-MUST-NOT-LEAK`;
  const paidFetch = withDispatchTracking(async () => new Response(responseBody, {
    status: 402,
    headers: {
      "content-type": "text/plain",
      "x-payment-response": encodePaymentResponseHeader(failedSettlement)
    }
  }));
  const agent = createAgent(undefined, paidFetch);
  await precheckAndQuote(agent, "TEST-NON-2XX-DIAGNOSTIC");

  await assert.rejects(
    () => agent.submit("TEST-NON-2XX-DIAGNOSTIC", quoteId, true),
    error => {
      const message = error instanceof Error ? error.message : String(error);
      assert.match(message, /SETTLEMENT_FAILED/);
      assert.match(message, /response body: /);
      assert.equal(message.includes("TAIL-MUST-NOT-LEAK"), false);
      return true;
    }
  );
  assert.equal(agent.getSettlementReconciliation(quoteId), undefined);
});

test("dispatched non-2xx responses without settlement headers require reconciliation", async () => {
  await assertInvalidSettlementBlocksRetry(
    "TEST-NON-2XX-MISSING-SETTLEMENT",
    null,
    /Customs broker payment failed: 402/,
    402
  );
});

test("non-2xx terminal failures with mismatched settlement fields remain ambiguous", async () => {
  const failedSettlement: SettleResponse = {
    success: false,
    errorReason: "SETTLEMENT_FAILED",
    transaction: successfulSettlement.transaction,
    network: "eip155:1",
    payer: importerAddress,
    amount: "10000"
  };
  await assertInvalidSettlementBlocksRetry(
    "TEST-NON-2XX-MISMATCHED-TERMINAL",
    encodePaymentResponseHeader(failedSettlement),
    /Customs broker payment failed: 402/,
    402
  );
});

test("non-2xx terminal failures with malformed or zero transactions remain ambiguous", async () => {
  for (const [label, transaction] of [
    ["malformed", "0x1234"],
    ["zero", `0x${"0".repeat(64)}`]
  ] as const) {
    const failedSettlement: SettleResponse = {
      success: false,
      errorReason: "SETTLEMENT_FAILED",
      transaction,
      network,
      payer: importerAddress
    };
    await assertInvalidSettlementBlocksRetry(
      `TEST-NON-2XX-${label.toUpperCase()}-TRANSACTION`,
      encodePaymentResponseHeader(failedSettlement),
      /Customs broker payment failed: 402/,
      402
    );
  }
});

test("non-2xx settlement responses retain a broadcast transaction for settlement_pending", async () => {
  const failedSettlement: SettleResponse = {
    success: false,
    errorReason: "settlement_pending",
    transaction: "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
    network,
    payer: importerAddress
  };
  const agent = createAgent(undefined, fakePaidFetch(undefined, 402, encodePaymentResponseHeader(failedSettlement)));
  await precheckAndQuote(agent, "TEST-SETTLEMENT-PENDING");

  await assert.rejects(
    () => agent.submit("TEST-SETTLEMENT-PENDING", quoteId, true),
    /settlement_pending/
  );
  assert.deepEqual(agent.getPendingSettlement(quoteId), failedSettlement);
});

test("payment transport failure records an ambiguous outcome and blocks retry", async () => {
  let calls = 0;
  const agent = createAgent(undefined, withDispatchTracking(async () => {
    calls += 1;
    throw new Error("broker connection lost");
  }));
  await precheckAndQuote(agent, "TEST-TRANSPORT-AMBIGUOUS");
  await assert.rejects(
    () => agent.submit("TEST-TRANSPORT-AMBIGUOUS", quoteId, true),
    /broker connection lost/
  );
  await assert.rejects(
    () => agent.submit("TEST-TRANSPORT-AMBIGUOUS", quoteId, true),
    /pending reconciliation/
  );
  assert.equal(calls, 1);
  assert.equal(agent.getSettlementReconciliation(quoteId)?.reason, "payment_transport_error");
});

test("pre-dispatch payment creation failure does not create reconciliation state", async () => {
  let calls = 0;
  const preDispatchFailure = Object.assign(
    async () => {
      calls += 1;
      throw new Error("signer unavailable");
    },
    { getPaymentDispatchState: () => false }
  );
  const agent = createAgent(undefined, preDispatchFailure);
  await precheckAndQuote(agent, "TEST-PRE-DISPATCH");
  await assert.rejects(
    () => agent.submit("TEST-PRE-DISPATCH", quoteId, true),
    /signer unavailable/
  );
  assert.equal(agent.getSettlementReconciliation(quoteId), undefined);
  await assert.rejects(
    () => agent.submit("TEST-PRE-DISPATCH", quoteId, true),
    /signer unavailable/
  );
  assert.equal(calls, 2);
});

test("paid fetch without dispatch tracking is rejected before reservation or network call", async () => {
  let calls = 0;
  const untrackedPaidFetch = (async () => {
    calls += 1;
    return fakePaidFetch()("http://broker.test");
  }) as unknown as PaymentDispatchAwareFetch;
  const agent = createAgent(undefined, untrackedPaidFetch);
  await precheckAndQuote(agent, "TEST-UNTRACKED-DISPATCH");

  await assert.rejects(
    () => agent.submit("TEST-UNTRACKED-DISPATCH", quoteId, true),
    /Payment dispatch tracking is required/
  );
  assert.equal(calls, 0);
});

test("dispatch tracking failure after transport error records reconciliation before holding", async () => {
  let trackerCalls = 0;
  let paidFetchCalls = 0;
  const paidFetch = Object.assign(
    (async () => {
      paidFetchCalls += 1;
      throw new Error("broker connection lost");
    }) as typeof globalThis.fetch,
    {
      getPaymentDispatchState: () => {
        trackerCalls += 1;
        if (trackerCalls === 1) return false;
        throw new Error("dispatch tracker unavailable");
      }
    }
  ) as PaymentDispatchAwareFetch;
  const reservationStore = new PaymentReservationStore();
  const agent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    paidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    new Map(),
    new Map(),
    [],
    network,
    new Map(),
    reservationStore
  );
  await precheckAndQuote(agent, "TEST-TRACKING-TRANSPORT-ERROR");

  await assert.rejects(
    () => agent.submit("TEST-TRACKING-TRANSPORT-ERROR", quoteId, true),
    /broker connection lost/
  );
  const reconciliation = agent.getSettlementReconciliation(quoteId);
  assert.equal(reconciliation?.reason, "payment_dispatch_tracking_failed");
  assert.equal(reconciliation?.state, "ambiguous");
  assert.equal(reservationStore.get(reconciliation!.reservationId!)?.state, "ambiguous");
  assert.equal(paidFetchCalls, 1);
});

test("dispatch tracking failure after a response records reconciliation before holding", async () => {
  let trackerCalls = 0;
  let paidFetchCalls = 0;
  const paidFetch = Object.assign(
    (async () => {
      paidFetchCalls += 1;
      return new Response("gateway failure", { status: 402 });
    }) as typeof globalThis.fetch,
    {
      getPaymentDispatchState: () => {
        trackerCalls += 1;
        if (trackerCalls === 1) return false;
        throw new Error("dispatch tracker unavailable");
      }
    }
  ) as PaymentDispatchAwareFetch;
  const reservationStore = new PaymentReservationStore();
  const agent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    paidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    new Map(),
    new Map(),
    [],
    network,
    new Map(),
    reservationStore
  );
  await precheckAndQuote(agent, "TEST-TRACKING-RESPONSE-ERROR");

  await assert.rejects(
    () => agent.submit("TEST-TRACKING-RESPONSE-ERROR", quoteId, true),
    /dispatch tracker unavailable/
  );
  const reconciliation = agent.getSettlementReconciliation(quoteId);
  assert.equal(reconciliation?.reason, "payment_dispatch_tracking_failed");
  assert.equal(reconciliation?.state, "ambiguous");
  assert.equal(reservationStore.get(reconciliation!.reservationId!)?.state, "ambiguous");
  assert.equal(paidFetchCalls, 1);
});

test("a successful response without a dispatched payment cannot file", async () => {
  const noDispatchFetch = Object.assign(
    fakePaidFetch(),
    { getPaymentDispatchState: () => false }
  );
  const agent = createAgent(undefined, noDispatchFetch);
  await precheckAndQuote(agent, "TEST-RESPONSE-WITHOUT-DISPATCH");
  await assert.rejects(
    () => agent.submit("TEST-RESPONSE-WITHOUT-DISPATCH", quoteId, true),
    /without a dispatched payment signature/
  );
  assert.equal(agent.getSettlementReconciliation(quoteId), undefined);
});

test("settlement_pending is shared across importer agent instances and blocks retry", async () => {
  const preflightStore = new Map();
  const quoteStore = new Map();
  const history: import("../src/payment/policy.js").PaymentRecord[] = [];
  const pendingStore = new Map<string, SettlementReconciliationRecord>();
  const reservationStore = new PaymentReservationStore();
  const pendingTransaction = `0x${"b".repeat(64)}`;
  const failedPaidFetch = fakePaidFetch(
    undefined,
    402,
    encodePaymentResponseHeader({
      success: false,
      errorReason: "settlement_pending",
      transaction: pendingTransaction,
      network,
      payer: importerAddress
    })
  );
  const firstAgent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    failedPaidFetch,
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    history,
    network,
    pendingStore,
    reservationStore
  );
  await precheckAndQuote(firstAgent, "TEST-SHARED-PENDING");
  await assert.rejects(
    () => firstAgent.submit("TEST-SHARED-PENDING", quoteId, true),
    /settlement_pending/
  );

  let retryCalls = 0;
  const secondAgent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    withDispatchTracking(async () => {
      retryCalls += 1;
      return failedPaidFetch("http://broker.test");
    }),
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    history,
    network,
    pendingStore,
    reservationStore
  );
  await assert.rejects(
    () => secondAgent.submit("TEST-SHARED-PENDING", quoteId, true),
    /pending reconciliation/
  );
  assert.equal(retryCalls, 0);
  assert.equal(
    secondAgent.getPendingSettlement(quoteId)?.transaction,
    [...pendingStore.values()][0]?.settlement?.transaction
  );
  const reconciliation = secondAgent.getSettlementReconciliation(quoteId);
  assert.equal(reconciliation?.brokerEndpoint, "http://broker.test");
  assert.equal(reconciliation?.brokerAddress, brokerAddress);
  assert.equal(reconciliation?.network, network);
  assert.equal(reconciliation?.declarationId, quote.declarationId);
  assert.ok(reconciliation?.documentsHash);
  assert.ok(reconciliation?.attemptId);
  assert.equal(reconciliation?.reservationId !== undefined, true);
  assert.equal(reservationStore.get(reconciliation!.reservationId!)?.state, "ambiguous");
  const terminalFailure: SettleResponse = {
    success: false,
    transaction: `0x${"c".repeat(64)}`,
    network,
    errorReason: "reverted"
  };
  assert.equal(
    secondAgent.markSettlementReconciled(
      "TEST-SHARED-PENDING",
      quoteId,
      "ATTEMPT-not-the-owner",
      terminalFailure
    ),
    false
  );
  assert.equal(
    secondAgent.getSettlementReconciliation(quoteId)?.settlement?.transaction,
    pendingTransaction
  );
  assert.throws(
    () => secondAgent.markSettlementReconciled(
      "TEST-SHARED-PENDING",
      quoteId,
      reconciliation!.attemptId,
      terminalFailure
    ),
    /transaction.*recorded/i
  );
  assert.ok(secondAgent.getSettlementReconciliation(quoteId));
  assert.equal(reservationStore.get(reconciliation!.reservationId!)?.state, "ambiguous");
  assert.equal(
    secondAgent.markSettlementReconciled(
      "TEST-SHARED-PENDING",
      quoteId,
      reconciliation!.attemptId,
      { ...terminalFailure, transaction: `0x${"B".repeat(64)}` }
    ),
    true
  );
  assert.equal(secondAgent.getSettlementReconciliation(quoteId), undefined);
  assert.equal(reservationStore.get(reconciliation!.reservationId!), undefined);
});

test("invalid recorded reconciliation transactions cannot be treated as missing", async () => {
  for (const [label, recordedTransaction] of [
    ["whitespace", "   "],
    ["padded hash", ` 0x${"b".repeat(64)} `]
  ] as const) {
    const agent = createAgent(undefined, fakePaidFetch(
      undefined,
      402,
      encodePaymentResponseHeader({
        success: false,
        errorReason: "settlement_pending",
        transaction: recordedTransaction,
        network,
        payer: importerAddress
      })
    ));
    const orderId = `TEST-INVALID-RECORDED-${label}`;
    await precheckAndQuote(agent, orderId);
    await assert.rejects(() => agent.submit(orderId, quoteId, true), /settlement_pending/);
    const reconciliation = agent.getSettlementReconciliation(quoteId);
    assert.ok(reconciliation);
    assert.throws(
      () => agent.markSettlementReconciled(
        orderId,
        quoteId,
        reconciliation.attemptId,
        { success: false, transaction: "", network, errorReason: "reverted" }
      ),
      /Recorded reconciliation transaction is not a valid non-zero 32-byte hash/
    );
    assert.ok(agent.getSettlementReconciliation(quoteId));
  }
});

test("failed settlement keeps the quote available for a valid retry", async () => {
  let attempts = 0;
  const failedSettlement: SettleResponse = {
    success: false,
    errorReason: "SETTLEMENT_FAILED",
    transaction: successfulSettlement.transaction,
    network,
    payer: importerAddress
  };
  const paidFetch = withDispatchTracking(async () => {
    attempts += 1;
    const settlement = attempts === 1 ? failedSettlement : successfulSettlement;
    const headers = new Headers({
      "content-type": "application/json",
      "payment-response": encodePaymentResponseHeader(settlement)
    });
    return new Response(JSON.stringify({
      quote,
      receipt: {
        receiptId: "CBR-TEST",
        declarationId: quote.declarationId,
        brokerFeeUsd: 0.01,
        brokerAddress,
        status: "filed",
        timestamp: new Date().toISOString()
      }
    }), { status: attempts === 1 ? 402 : 200, headers });
  });
  const agent = createAgent(undefined, paidFetch);
  await precheckAndQuote(agent, "TEST-RETRY");

  await assert.rejects(
    () => agent.submit("TEST-RETRY", quoteId, true),
    /SETTLEMENT_FAILED/
  );
  const result = await agent.submit("TEST-RETRY", quoteId, true);

  assert.equal(attempts, 2);
  assert.equal(result.settlement.transaction, successfulSettlement.transaction);
});

test("a successful settlement cannot authorize a mismatched broker response", async () => {
  const history: import("../src/payment/policy.js").PaymentRecord[] = [];
  const mismatchedQuote = { ...quote, quoteId: "QUOTE-OTHER" };
  const bodyMismatchAgent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(undefined, quote),
    withDispatchTracking(async () => new Response(JSON.stringify({
      quote: mismatchedQuote,
      receipt: {
        receiptId: "CBR-TEST",
        declarationId: quote.declarationId,
        brokerFeeUsd: 0.01,
        brokerAddress,
        status: "filed",
        timestamp: new Date().toISOString()
      }
    }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "payment-response": encodePaymentResponseHeader(successfulSettlement)
      }
    })),
    0.01,
    brokerAddress,
    importerAddress,
    new Map(),
    new Map(),
    history
  );
  await precheckAndQuote(bodyMismatchAgent, "TEST-MISMATCHED-BODY");
  await assert.rejects(
    () => bodyMismatchAgent.submit("TEST-MISMATCHED-BODY", quoteId, true),
    /does not match the reviewed quote/
  );
  assert.equal(history.length, 0);
  assert.equal(bodyMismatchAgent.getSettlementReconciliation(quoteId)?.state, "ambiguous");
});

test("a one-atomic-unit receipt fee mismatch is rejected", async () => {
  const preflightStore = new Map();
  const quoteStore = new Map();
  const history: import("../src/payment/policy.js").PaymentRecord[] = [];
  const agent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    fakePaidFetch(undefined, 200, undefined, brokerAddress, quote, 0.010001),
    0.01,
    brokerAddress,
    importerAddress,
    preflightStore,
    quoteStore,
    history
  );
  await precheckAndQuote(agent, "TEST-ATOMIC-FEE-MISMATCH");
  await assert.rejects(
    () => agent.submit("TEST-ATOMIC-FEE-MISMATCH", quoteId, true),
    /receipt/
  );
  assert.equal(history.length, 0);
  assert.equal(quoteStore.has(quoteId), true);
});

test("receipt broker fee must be a finite number", async () => {
  const agent = createAgent(
    undefined,
    fakePaidFetch(undefined, 200, undefined, brokerAddress, quote, "0.01" as unknown as number)
  );
  await precheckAndQuote(agent, "TEST-RECEIPT-FEE-TYPE");
  await assert.rejects(
    () => agent.submit("TEST-RECEIPT-FEE-TYPE", quoteId, true),
    /receipt has an invalid broker fee/
  );
});

test("quote errors include bounded response-body diagnostics", async () => {
  const diagnosticBody = `${"a".repeat(520)}TAIL-MUST-NOT-LEAK`;
  const agent = createAgent(
    undefined,
    undefined,
    async () => new Response(diagnosticBody, {
      status: 503,
      headers: { "content-type": "text/plain" }
    })
  );
  const orderId = "TEST-QUOTE-ERROR-DIAGNOSTIC";
  const preflight = agent.precheck(orderId, getMockExportDocuments(orderId));
  await assert.rejects(
    () => agent.getQuote(preflight.preflightId, true),
    error => {
      assert.match(error instanceof Error ? error.message : String(error), /Customs quote failed: 503/);
      assert.equal((error instanceof Error ? error.message : String(error)).includes("TAIL-MUST-NOT-LEAK"), false);
      return true;
    }
  );
});

test("broker fees beyond USDC precision are rejected instead of truncated", async () => {
  const preciseFee = 0.0100001;
  const preciseQuote = { ...quote, customsBrokerFeeUsd: preciseFee };
  let paidFetchCalls = 0;
  const agent = createAgent(
    undefined,
    fakePaidFetch(() => { paidFetchCalls += 1; }),
    freeQuoteFetch(undefined, preciseQuote),
    preciseFee
  );
  await precheckAndQuote(agent, "TEST-FEE-PRECISION");

  await assert.rejects(
    () => agent.submit("TEST-FEE-PRECISION", quoteId, true),
    /cannot be represented exactly with USDC's 6 decimals/
  );
  assert.equal(paidFetchCalls, 0);
});
