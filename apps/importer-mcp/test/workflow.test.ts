import assert from "node:assert/strict";
import { test } from "node:test";
import { ImporterAgent } from "../src/importer-agent.js";
import { getMockExportDocuments } from "../src/mock-exporter.js";
import { validDutyQuote } from "./fixtures.js";

const importerAddress = "0x1111111111111111111111111111111111111111";
const brokerAddress = "0x2222222222222222222222222222222222222222";
const quoteId = validDutyQuote.quoteId;
const quote = validDutyQuote;

function freeQuoteFetch(onCall?: () => void): typeof globalThis.fetch {
  return async () => {
    onCall?.();
    return new Response(JSON.stringify({ quote }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
}

function fakePaidFetch(
  onCall?: () => void,
  receiptBrokerAddress = brokerAddress,
): typeof globalThis.fetch {
  return async () => {
    onCall?.();
    return new Response(
      JSON.stringify({
        quote,
        receipt: {
          receiptId: "CBR-TEST",
          declarationId: quote.declarationId,
          brokerFeeUsd: 0.01,
          brokerAddress: receiptBrokerAddress,
          status: "filed",
          timestamp: new Date().toISOString(),
        },
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  };
}

function createAgent(
  policy = {
    maxPaymentUsd: 1,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0,
  },
  paidFetch = fakePaidFetch(),
  quoteFetch = freeQuoteFetch(),
) {
  return new ImporterAgent(
    "http://broker.test",
    policy,
    quoteFetch,
    paidFetch,
    0.01,
    brokerAddress,
    importerAddress,
  );
}

async function precheckAndQuote(agent: ImporterAgent, orderId: string) {
  const preflight = agent.precheck(orderId, getMockExportDocuments(orderId));
  return agent.getQuote(preflight.preflightId, true);
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

test("importer and customs broker may use the same address", async () => {
  const agent = new ImporterAgent(
    "http://broker.test",
    {
      maxPaymentUsd: 1,
      allowedPayees: [importerAddress],
      requireHumanApprovalAboveUsd: 0,
    },
    freeQuoteFetch(),
    fakePaidFetch(undefined, importerAddress),
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
    fakePaidFetch(undefined, unexpectedBroker),
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
    "packing_list",
  ]);
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
