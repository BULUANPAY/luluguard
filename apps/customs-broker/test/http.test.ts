import assert from "node:assert/strict";
import { once } from "node:events";
import type { Server } from "node:http";
import { test } from "node:test";
import type { AddressInfo } from "node:net";
import { x402Client, wrapFetchWithPayment } from "@x402/fetch";
import {
  decodePaymentSignatureHeader,
  decodePaymentRequiredHeader,
  decodePaymentResponseHeader,
  encodePaymentSignatureHeader
} from "@x402/core/http";
import type {
  PaymentPayload,
  SettleResponse,
  SupportedResponse,
  VerifyResponse
} from "@x402/core/types";
import { FacilitatorTimeoutError, type FacilitatorClient } from "@x402/core/server";
import { ExactEvmScheme } from "@x402/evm/exact/client";
import { privateKeyToAccount } from "viem/accounts";
import { createApp } from "../src/app.js";
import type { BrokerAppOptions } from "../src/app.js";
import type { BrokerConfig } from "../src/config.js";
import type { ExportDocuments } from "../src/domain.js";
import { QuoteStore, QuoteStoreError } from "../src/quote-store.js";

const network = "eip155:84532" as const;
const brokerAddress = "0x2222222222222222222222222222222222222222";
const buyer = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
);
const transaction = `0x${"a".repeat(64)}`;

const documents: ExportDocuments = {
  invoiceNumber: "INV-HTTP-001",
  invoiceDate: "2026-08-29",
  exporter: "Tokyo Precision Instruments Co., Ltd.",
  importer: "Formosa Industrial Systems Co., Ltd.",
  originCountry: "JP",
  destinationCountry: "TW",
  currency: "USD",
  incoterm: "CIF",
  freightUsd: 80,
  insuranceUsd: 12,
  packageCount: 2,
  grossWeightKg: 18.4,
  netWeightKg: 15.2,
  billOfLadingNumber: "ONEYTYOTEST",
  providedDocuments: ["commercial_invoice", "packing_list", "bill_of_lading"],
  items: [{
    description: "Industrial digital temperature sensors",
    model: "TSP-500",
    material: "Stainless-steel probe",
    intendedUse: "Temperature monitoring",
    quantity: 10,
    unitPriceUsd: 120,
    hsCode: "9025.19"
  }]
};

const brokerConfig: BrokerConfig = {
  host: "127.0.0.1",
  port: 0,
  address: brokerAddress,
  feeUsdc: 0.01,
  quoteTtlSeconds: 300,
  network,
  facilitatorUrl: "http://facilitator.invalid",
  facilitatorTimeoutMs: 1_000,
  logLevel: "error"
};

class FakeFacilitator implements FacilitatorClient {
  readonly events: string[] = [];
  flowEvents?: string[];
  beforeSettle?: () => void;
  settleBarrier?: Promise<void>;
  settleError?: Error;
  settleErrors?: Error[];
  settleResponses?: SettleResponse[];
  verifyPayload?: PaymentPayload;
  verifyResponse: VerifyResponse = { isValid: true, payer: buyer.address };
  settleResponse: SettleResponse = {
    success: true,
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };

  async getSupported(): Promise<SupportedResponse> {
    this.events.push("supported");
    return {
      kinds: [{ x402Version: 2, scheme: "exact", network }],
      extensions: [],
      signers: { "eip155:*": [] }
    };
  }

  async verify(payload: PaymentPayload): Promise<VerifyResponse> {
    this.events.push("verify");
    this.flowEvents?.push("verify");
    this.verifyPayload = payload;
    return this.verifyResponse;
  }

  async settle(): Promise<SettleResponse> {
    this.events.push("settle");
    this.flowEvents?.push("settle");
    this.beforeSettle?.();
    if (this.settleBarrier) await this.settleBarrier;
    const queuedError = this.settleErrors?.shift();
    if (queuedError) throw queuedError;
    if (this.settleError) throw this.settleError;
    const queuedResponse = this.settleResponses?.shift();
    if (queuedResponse !== undefined) return queuedResponse;
    return this.settleResponse;
  }
}

class HandlerThrowingQuoteStore extends QuoteStore {
  override prepareReceipt(...args: Parameters<QuoteStore["prepareReceipt"]>): ReturnType<QuoteStore["prepareReceipt"]> {
    void args;
    throw new Error("simulated handler failure");
  }
}

async function start(
  facilitator = new FakeFacilitator(),
  quoteStore: QuoteStore | undefined = undefined,
  prepareDeclaration: BrokerAppOptions["prepareDeclaration"] = undefined,
  maxPaymentTombstones: BrokerAppOptions["maxPaymentTombstones"] = undefined,
  logger: BrokerAppOptions["logger"] = undefined
) {
  const created = createApp({
    config: brokerConfig,
    facilitatorClient: facilitator,
    ...(quoteStore === undefined ? {} : { quoteStore }),
    ...(prepareDeclaration === undefined ? {} : { prepareDeclaration }),
    ...(maxPaymentTombstones === undefined ? {} : { maxPaymentTombstones }),
    ...(logger === undefined ? {} : { logger })
  });
  const server = created.app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address() as AddressInfo;
  return { ...created, facilitator, server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function close(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close(error => error ? reject(error) : resolve());
  });
}

async function createQuote(baseUrl: string) {
  const response = await fetch(`${baseUrl}/customs/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(documents)
  });
  assert.equal(response.status, 200);
  return (await response.json()) as { quote: { quoteId: string } };
}

interface CapturedRequest {
  method: string;
  url: string;
  headers: Headers;
  body: string;
}

function paidFetch(
  counts?: { requests: number },
  requestHeaders?: Headers[],
  capturedRequests?: CapturedRequest[]
) {
  const client = new x402Client().setSpendControls({ maxAmountPerPayment: "$1" });
  client.register(network, new ExactEvmScheme(buyer));
  return wrapFetchWithPayment(async (input, init) => {
    const request = new Request(input, init);
    if (counts) counts.requests += 1;
    requestHeaders?.push(new Headers(request.headers));
    if (capturedRequests) {
      capturedRequests.push({
        method: request.method,
        url: request.url,
        headers: new Headers(request.headers),
        body: await request.clone().text()
      });
    }
    return fetch(request);
  }, client);
}

function declarationInit(quoteId: string): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ quoteId, documents })
  };
}

async function createSinglePaymentHeader(baseUrl: string, quoteId: string): Promise<string> {
  const challenge = await fetch(
    `${baseUrl}/customs/declarations`,
    declarationInit(quoteId)
  );
  assert.equal(challenge.status, 402);
  const required = decodePaymentRequiredHeader(challenge.headers.get("payment-required")!);
  const client = new x402Client();
  client.register(network, new ExactEvmScheme(buyer));
  return encodePaymentSignatureHeader(await client.createPaymentPayload(required));
}

test("health and free quotation do not require payment", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const health = await fetch(`${running.baseUrl}/health`);
  assert.deepEqual(await health.json(), { status: "ok", service: "x402-customs-broker" });
  const quote = await fetch(`${running.baseUrl}/customs/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(documents)
  });
  assert.equal(quote.status, 200);
  assert.equal(quote.headers.get("payment-required"), null);
  assert.deepEqual(running.facilitator.events, ["supported"]);
});

test("schema and required-document validation fail before payment", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const missingBillOfLading = {
    ...documents,
    billOfLadingNumber: undefined,
    providedDocuments: ["commercial_invoice", "packing_list"] as const
  };
  const response = await fetch(`${running.baseUrl}/customs/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(missingBillOfLading)
  });
  assert.equal(response.status, 400);
  assert.match((await response.json() as { error: string }).error, /bill_of_lading/);
  assert.deepEqual(running.facilitator.events, ["supported"]);
});

test("quote capacity fails closed with a service-unavailable response", async (t) => {
  const running = await start(new FakeFacilitator(), new QuoteStore({ maxRecords: 1 }));
  t.after(() => close(running.server));
  await createQuote(running.baseUrl);
  const response = await fetch(`${running.baseUrl}/customs/quotes`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(documents)
  });
  assert.equal(response.status, 503);
  assert.match((await response.json() as { error: string }).error, /capacity/);
});

test("a valid unpaid declaration receives an x402 v2 challenge", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await fetch(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 402);
  const header = response.headers.get("payment-required");
  assert.ok(header);
  const required = decodePaymentRequiredHeader(header);
  assert.equal(required.x402Version, 2);
  assert.equal(required.accepts.length, 1);
  assert.equal(required.accepts[0]?.scheme, "exact");
  assert.equal(required.accepts[0]?.network, network);
  assert.equal(required.accepts[0]?.payTo.toLowerCase(), brokerAddress.toLowerCase());
  assert.equal(required.accepts[0]?.amount, "10000");
  assert.equal(required.accepts[0]?.asset, "0x036CbD53842c5426634e7929541eC2318f3dCF7e");
  assert.equal(required.resource?.description, "File a reviewed customs declaration");
  assert.equal(required.resource?.mimeType, "application/json");
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
});

test("the buyer retries with the same body and receives a settled declaration", async (t) => {
  const flowEvents: string[] = [];
  const facilitator = new FakeFacilitator();
  facilitator.flowEvents = flowEvents;
  const running = await start(facilitator, undefined, () => {
    flowEvents.push("handler");
  });
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const counts = { requests: 0 };
  const capturedRequests: CapturedRequest[] = [];
  const expectedDeclaration = { quoteId: quote.quoteId, documents };
  const response = await paidFetch(counts, undefined, capturedRequests)(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );

  assert.equal(response.status, 200);
  assert.equal(counts.requests, 2);
  assert.equal(capturedRequests.length, 2);
  assert.equal(capturedRequests[0]?.method, "POST");
  assert.equal(capturedRequests[1]?.method, "POST");
  assert.equal(capturedRequests[0]?.headers.has("payment-signature"), false);
  assert.equal(capturedRequests[1]?.headers.has("payment-signature"), true);
  assert.equal(capturedRequests[0]?.body, capturedRequests[1]?.body);
  assert.deepEqual(JSON.parse(capturedRequests[0]!.body), expectedDeclaration);
  assert.deepEqual(JSON.parse(capturedRequests[1]!.body), expectedDeclaration);
  assert.deepEqual(flowEvents, ["verify", "handler", "settle"]);

  const settlementHeader = response.headers.get("payment-response");
  assert.ok(settlementHeader);
  assert.deepEqual(decodePaymentResponseHeader(settlementHeader), facilitator.settleResponse);
  const body = await response.json() as {
    quote: { quoteId: string };
    receipt: { status: string; receiptId: string };
  };
  assert.equal(body.quote.quoteId, quote.quoteId);
  assert.equal(body.receipt.status, "filed");
  assert.equal(typeof facilitator.verifyPayload?.payload.signature, "string");
  const record = running.quoteStore.getOrThrow(quote.quoteId);
  assert.equal(record.status, "FILED");
  assert.equal(record.receipt?.receiptId, body.receipt.receiptId);
  assert.equal(record.settlement?.transaction, transaction);
  assert.equal(record.settlement?.network, network);
  assert.equal(record.settlement?.payer, buyer.address);
  assert.deepEqual(facilitator.events, ["supported", "verify", "settle"]);
});

test("structured logs expose the payment lifecycle without signed payment data", async (t) => {
  const logs: Array<{
    level: string;
    event: string;
    data: Record<string, unknown>;
  }> = [];
  const logger: NonNullable<BrokerAppOptions["logger"]> = (level, event, data = {}) => {
    logs.push({ level, event, data });
  };
  const facilitator = new FakeFacilitator();
  const running = await start(facilitator, undefined, undefined, undefined, logger);
  t.after(() => close(running.server));

  const firstQuote = await createQuote(running.baseUrl);
  const capturedRequests: CapturedRequest[] = [];
  const succeeded = await paidFetch(undefined, undefined, capturedRequests)(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(firstQuote.quote.quoteId)
  );
  assert.equal(succeeded.status, 200);

  const secondQuote = await createQuote(running.baseUrl);
  facilitator.verifyResponse = {
    isValid: false,
    invalidReason: "insufficient_funds",
    payer: buyer.address
  };
  const failed = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(secondQuote.quote.quoteId)
  );
  assert.equal(failed.status, 402);

  const verifyStarted = logs.find(entry =>
    entry.event === "payment.verify_started" && entry.data.quoteId === firstQuote.quote.quoteId
  );
  assert.equal(verifyStarted?.data.network, network);
  const verifySucceeded = logs.find(entry =>
    entry.event === "payment.verify_succeeded" && entry.data.quoteId === firstQuote.quote.quoteId
  );
  assert.equal(verifySucceeded?.data.payer, buyer.address);
  const prepared = logs.find(entry =>
    entry.event === "declaration.prepared" && entry.data.quoteId === firstQuote.quote.quoteId
  );
  assert.match(String(prepared?.data.attemptId), /^ATTEMPT-/);
  const settled = logs.find(entry =>
    entry.event === "declaration.settled" && entry.data.quoteId === firstQuote.quote.quoteId
  );
  assert.equal(settled?.data.transaction, transaction);
  assert.equal(settled?.data.network, network);
  assert.equal(settled?.data.payer, buyer.address);
  const verifyFailed = logs.find(entry =>
    entry.event === "payment.verify_failed" && entry.data.quoteId === secondQuote.quote.quoteId
  );
  assert.equal(verifyFailed?.data.reason, "insufficient_funds");

  const paymentHeader = capturedRequests[1]?.headers.get("payment-signature");
  assert.ok(paymentHeader);
  const signedPayload = decodePaymentSignatureHeader(paymentHeader);
  const signature = String(signedPayload.payload.signature);
  const serializedLogs = JSON.stringify(logs);
  assert.equal(serializedLogs.includes(paymentHeader), false);
  assert.equal(serializedLogs.includes(signature), false);
  assert.equal(serializedLogs.includes("authorization"), false);
  assert.equal(serializedLogs.includes("0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"), false);
});

test("logger failures do not change the payment result", async (t) => {
  const running = await start(
    new FakeFacilitator(),
    undefined,
    undefined,
    undefined,
    () => { throw new Error("logger unavailable"); }
  );
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );

  assert.equal(response.status, 200);
  assert.ok(response.headers.get("payment-response"));
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});

test("the declaration response stays buffered until settlement succeeds", async (t) => {
  const facilitator = new FakeFacilitator();
  let releaseSettlement!: () => void;
  facilitator.settleBarrier = new Promise<void>(resolve => { releaseSettlement = resolve; });
  let settlementStarted!: () => void;
  const started = new Promise<void>(resolve => { settlementStarted = resolve; });
  facilitator.beforeSettle = settlementStarted;
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  let responseResolved = false;
  const responsePromise = paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  ).then(response => {
    responseResolved = true;
    return response;
  });

  await started;
  assert.equal(responseResolved, false);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "PROCESSING");

  releaseSettlement();
  const response = await responsePromise;
  assert.equal(response.status, 200);
  assert.ok(response.headers.get("payment-response"));
  assert.equal((await response.json() as { receipt: { status: string } }).receipt.status, "filed");
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});

test("verification failure never executes or settles the declaration", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.verifyResponse = {
    isValid: false,
    invalidReason: "insufficient_funds",
    payer: buyer.address
  };
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.deepEqual(facilitator.events, ["supported", "verify"]);
});

test("a handler 4xx response rolls back without settlement", async (t) => {
  const facilitator = new FakeFacilitator();
  const running = await start(facilitator, undefined, ({ declaration }) => {
    throw new QuoteStoreError(
      "PAYMENT_ALREADY_BOUND",
      declaration.quoteId,
      "simulated handler conflict"
    );
  });
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 409);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.deepEqual(facilitator.events, ["supported", "verify"]);
});

test("a handler failure rolls back the processing attempt before cancellation completes", async (t) => {
  const facilitator = new FakeFacilitator();
  const store = new HandlerThrowingQuoteStore();
  const running = await start(facilitator, store);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 500);
  assert.equal(store.getOrThrow(quote.quoteId).status, "OPEN");
  assert.deepEqual(facilitator.events, ["supported", "verify"]);
});

test("middleware cancellation rolls back the owner after preparation fails", async (t) => {
  const facilitator = new FakeFacilitator();
  const store = new QuoteStore();
  const handlerStatuses: string[] = [];
  let quoteId = "";
  const running = await start(facilitator, store, ({ quote }) => {
    handlerStatuses.push(store.getOrThrow(quoteId).status);
    assert.equal(quote.quoteId, quoteId);
    throw new Error("simulated downstream failure");
  });
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  quoteId = quote.quoteId;

  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );

  assert.equal(response.status, 500);
  assert.deepEqual(handlerStatuses, ["PROCESSING"]);
  assert.equal(store.getOrThrow(quote.quoteId).status, "OPEN");
  assert.deepEqual(facilitator.events, ["supported", "verify"]);
});

test("settlement failure discards the prepared response and releases the quote", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: false,
    errorReason: "insufficient_funds",
    transaction: "",
    network,
    payer: buyer.address
  };
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 402);
  const settlementHeader = response.headers.get("payment-response");
  assert.ok(settlementHeader);
  assert.equal(decodePaymentResponseHeader(settlementHeader).errorReason, "insufficient_funds");
  const failureBody = await response.json() as Record<string, unknown>;
  assert.equal("receipt" in failureBody, false);
  assert.equal("quote" in failureBody, false);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.deepEqual(facilitator.events, ["supported", "verify", "settle"]);
});

test("an explicit terminal SettleError releases the quote", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleError = Object.assign(new Error("insufficient funds"), {
    name: "SettleError",
    errorReason: "insufficient_funds",
    transaction: "",
    network,
    payer: buyer.address
  });
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.equal(running.facilitator.events.filter(event => event === "settle").length, 1);
});

test("settlement_pending is retried once before filing", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponses = [
    {
      success: false,
      errorReason: "settlement_pending",
      transaction,
      network,
      payer: buyer.address,
      amount: "10000"
    },
    facilitator.settleResponse
  ];
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 200);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});

test("pending followed by a terminal SettleError clears the payment tombstone", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponses = [{
    success: false,
    errorReason: "settlement_pending",
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  }];
  facilitator.settleErrors = [Object.assign(new Error("insufficient funds"), {
    name: "SettleError",
    errorReason: "insufficient_funds",
    transaction: "",
    network,
    payer: buyer.address
  })];
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const paymentHeader = await createSinglePaymentHeader(running.baseUrl, quote.quoteId);
  const paidInit = (): RequestInit => ({
    ...declarationInit(quote.quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  const failed = await fetch(`${running.baseUrl}/customs/declarations`, paidInit());
  assert.equal(failed.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");

  const retried = await fetch(`${running.baseUrl}/customs/declarations`, paidInit());
  assert.equal(retried.status, 200);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
  assert.equal(facilitator.events.filter(event => event === "verify").length, 2);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 3);
});

test("two pending settlements keep the quote blocked", async (t) => {
  const facilitator = new FakeFacilitator();
  const pending = {
    success: false as const,
    errorReason: "settlement_pending",
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };
  facilitator.settleResponses = [pending, pending];
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const response = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(response.status, 402);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "PROCESSING");
  const retry = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(retry.status, 409);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
});

test("an unresolved payment tombstone blocks replay against the same or another quote", async (t) => {
  const facilitator = new FakeFacilitator();
  const pending = {
    success: false as const,
    errorReason: "settlement_pending",
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };
  facilitator.settleResponses = [pending, pending];
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const paymentHeader = await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId);
  const paidInit = (quoteId: string): RequestInit => ({
    ...declarationInit(quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  const firstResponse = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(firstQuote.quote.quoteId)
  );
  assert.equal(firstResponse.status, 402);
  assert.equal(running.quoteStore.getOrThrow(firstQuote.quote.quoteId).status, "PROCESSING");

  const sameQuoteReplay = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(firstQuote.quote.quoteId)
  );
  const otherQuoteReplay = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(secondQuote.quote.quoteId)
  );
  assert.equal(sameQuoteReplay.status, 409);
  assert.equal(otherQuoteReplay.status, 402);
  assert.equal(running.quoteStore.getOrThrow(firstQuote.quote.quoteId).status, "PROCESSING");
  assert.equal(running.quoteStore.getOrThrow(secondQuote.quote.quoteId).status, "OPEN");
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
  assert.equal(facilitator.events.filter(event => event === "verify").length, 1);
});

test("invalid business requests fail before payment verification", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const mismatch = await fetch(`${running.baseUrl}/customs/declarations`, {
    ...declarationInit(quote.quoteId),
    body: JSON.stringify({ quoteId: quote.quoteId, documents: { ...documents, importer: "Changed" } })
  });
  assert.equal(mismatch.status, 409);
  const missing = await fetch(
    `${running.baseUrl}/customs/declarations`,
    declarationInit("QUOTE-MISSING")
  );
  assert.equal(missing.status, 404);
  assert.deepEqual(running.facilitator.events, ["supported"]);
});

test("concurrent paid submissions settle the quote at most once", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const fetchWithPayment = paidFetch();
  const results = await Promise.all([
    fetchWithPayment(`${running.baseUrl}/customs/declarations`, declarationInit(quote.quoteId)),
    fetchWithPayment(`${running.baseUrl}/customs/declarations`, declarationInit(quote.quoteId))
  ]);
  assert.equal(results.filter(response => response.status === 200).length, 1);
  assert.equal(results.filter(response => response.status === 409).length, 1);
  assert.equal(running.facilitator.events.filter(event => event === "settle").length, 1);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});

test("a filed quote rejects a later duplicate before verification", async (t) => {
  const running = await start();
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const first = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(first.status, 200);
  const duplicate = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(duplicate.status, 409);
  assert.deepEqual(running.facilitator.events, ["supported", "verify", "settle"]);
});

test("the same signed payment cannot file two different quotes", async (t) => {
  const facilitator = new FakeFacilitator();
  let releaseSettlement!: () => void;
  facilitator.settleBarrier = new Promise<void>(resolve => { releaseSettlement = resolve; });
  let settlementStarted!: () => void;
  const started = new Promise<void>(resolve => { settlementStarted = resolve; });
  facilitator.beforeSettle = settlementStarted;
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const paymentHeader = await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId);
  const paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  const authorization = paymentPayload.payload.authorization as Record<string, unknown>;
  const reorderedAuthorization = Object.fromEntries(Object.entries(authorization).reverse());
  const originalResource = paymentPayload.resource;
  assert.ok(originalResource);
  const reorderedHeader = encodePaymentSignatureHeader({
    ...paymentPayload,
    resource: {
      ...originalResource,
      url: "http://mutable-resource.invalid/customs/declarations",
      description: "mutated unsigned resource metadata"
    },
    payload: {
      authorization: reorderedAuthorization,
      signature: (paymentPayload.payload.signature as string).toUpperCase()
    }
  });
  const paidInit = (quoteId: string): RequestInit => ({
    ...declarationInit(quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  const first = fetch(`${running.baseUrl}/customs/declarations`, paidInit(firstQuote.quote.quoteId));
  await started;
  const second = fetch(`${running.baseUrl}/customs/declarations`, {
    ...paidInit(secondQuote.quote.quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": reorderedHeader
    }
  });
  const secondResponse = await second;
  assert.equal(secondResponse.status, 409);
  releaseSettlement();
  const firstResponse = await first;

  assert.equal(firstResponse.status, 200);
  assert.equal(running.facilitator.events.filter(event => event === "settle").length, 1);
  const records = [
    running.quoteStore.getOrThrow(firstQuote.quote.quoteId),
    running.quoteStore.getOrThrow(secondQuote.quote.quoteId)
  ];
  assert.equal(records.filter(record => record.status === "FILED").length, 1);
  assert.equal(records.filter(record => record.status === "OPEN").length, 1);
});

test("a canceled concurrent request cannot roll back the settling request", async (t) => {
  const facilitator = new FakeFacilitator();
  let releaseSettlement!: () => void;
  facilitator.settleBarrier = new Promise<void>(resolve => { releaseSettlement = resolve; });
  let settlementStarted!: () => void;
  const started = new Promise<void>(resolve => { settlementStarted = resolve; });
  facilitator.beforeSettle = settlementStarted;
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const first = paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  await started;
  const second = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(second.status, 409);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "PROCESSING");
  releaseSettlement();
  assert.equal((await first).status, 200);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
  assert.equal(facilitator.events.filter(event => event === "settle").length, 1);
});

test("malformed facilitator success fails closed and keeps the quote retryable", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: true,
    transaction: "not-a-transaction",
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const failed = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(failed.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");

  facilitator.settleResponse = {
    success: true,
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const retried = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(retried.status, 200);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
});

test("malformed success tombstones an exact payment replay while a new signature can retry", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: true,
    transaction: "not-a-transaction",
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const paymentHeader = await createSinglePaymentHeader(running.baseUrl, quote.quoteId);
  const paymentPayload = decodePaymentSignatureHeader(paymentHeader);
  const authorization = paymentPayload.payload.authorization as Record<string, unknown>;
  const equivalentHeader = encodePaymentSignatureHeader({
    ...paymentPayload,
    payload: {
      ...paymentPayload.payload,
      authorization: {
        ...authorization,
        value: `0x${BigInt(String(authorization.value)).toString(16)}`,
        validBefore: `0x${BigInt(String(authorization.validBefore)).toString(16)}`
      }
    }
  });
  const paidInit = (header = paymentHeader): RequestInit => ({
    ...declarationInit(quote.quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": header
    }
  });

  const first = await fetch(`${running.baseUrl}/customs/declarations`, paidInit());
  assert.equal(first.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.equal(facilitator.events.filter(event => event === "settle").length, 1);

  const replay = await fetch(`${running.baseUrl}/customs/declarations`, paidInit(equivalentHeader));
  assert.equal(replay.status, 402);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "OPEN");
  assert.equal(facilitator.events.filter(event => event === "settle").length, 1);
  assert.equal(facilitator.events.filter(event => event === "verify").length, 1);

  facilitator.settleResponse = {
    success: true,
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const retried = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(retried.status, 200);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "FILED");
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
});

test("a permit2 payment tombstone canonicalizes equivalent hex numerics", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: true,
    transaction: "not-a-transaction",
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const original = decodePaymentSignatureHeader(
    await createSinglePaymentHeader(running.baseUrl, quote.quoteId)
  );
  const eipAuthorization = original.payload.authorization as Record<string, unknown>;
  const permit2Authorization = {
    from: eipAuthorization.from,
    permitted: {
      token: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: String(eipAuthorization.value)
    },
    spender: brokerAddress,
    nonce: "7",
    deadline: String(eipAuthorization.validBefore),
    witness: {
      to: brokerAddress,
      validAfter: String(eipAuthorization.validAfter)
    }
  };
  const permit2Header = encodePaymentSignatureHeader({
    ...original,
    payload: {
      signature: original.payload.signature,
      permit2Authorization
    }
  });
  const asHex = (value: string): string => `0x${BigInt(value.trim()).toString(16)}`;
  const equivalentHeader = encodePaymentSignatureHeader({
    ...original,
    payload: {
      signature: original.payload.signature,
      permit2Authorization: {
        ...permit2Authorization,
        permitted: {
          ...permit2Authorization.permitted,
          amount: asHex(permit2Authorization.permitted.amount)
        },
        nonce: asHex(permit2Authorization.nonce),
        deadline: asHex(permit2Authorization.deadline),
        witness: {
          ...permit2Authorization.witness,
          validAfter: asHex(permit2Authorization.witness.validAfter)
        }
      }
    }
  });
  const paidInit = (paymentHeader: string): RequestInit => ({
    ...declarationInit(quote.quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  const first = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(permit2Header)
  );
  assert.equal(first.status, 402);
  const replay = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(equivalentHeader)
  );
  assert.equal(replay.status, 402);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 1);
  assert.equal(facilitator.events.filter(event => event === "verify").length, 1);
});

test("expired payment tombstones are lazily pruned", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleError = new FacilitatorTimeoutError("settle", brokerConfig.facilitatorTimeoutMs);
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const paymentPayload = decodePaymentSignatureHeader(
    await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId)
  );
  const authorization = paymentPayload.payload.authorization as Record<string, unknown>;
  const expiredHeader = encodePaymentSignatureHeader({
    ...paymentPayload,
    payload: {
      ...paymentPayload.payload,
      authorization: { ...authorization, validBefore: "0" }
    }
  });
  const paidInit = (quoteId: string): RequestInit => ({
    ...declarationInit(quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": expiredHeader
    }
  });

  const first = await fetch(`${running.baseUrl}/customs/declarations`, paidInit(firstQuote.quote.quoteId));
  assert.equal(first.status, 502);
  assert.equal(running.quoteStore.getOrThrow(firstQuote.quote.quoteId).status, "OPEN");

  // The cutoff is already expired, so the second request prunes the payment
  // tombstone and reaches verification for the independent quote.
  const second = await fetch(`${running.baseUrl}/customs/declarations`, paidInit(secondQuote.quote.quoteId));
  assert.equal(second.status, 502);
  assert.equal(running.quoteStore.getOrThrow(secondQuote.quote.quoteId).status, "OPEN");
  assert.equal(facilitator.events.filter(event => event === "verify").length, 2);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
});

test("different malformed payments fail closed at tombstone capacity", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: true,
    transaction: "not-a-transaction",
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const running = await start(facilitator, undefined, undefined, 2);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const thirdQuote = await createQuote(running.baseUrl);
  const firstHeader = await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId);
  const secondHeader = await createSinglePaymentHeader(running.baseUrl, secondQuote.quote.quoteId);
  const thirdHeader = await createSinglePaymentHeader(running.baseUrl, thirdQuote.quote.quoteId);
  const paidInit = (quoteId: string, paymentHeader: string): RequestInit => ({
    ...declarationInit(quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  assert.notEqual(
    decodePaymentSignatureHeader(firstHeader).payload.signature,
    decodePaymentSignatureHeader(secondHeader).payload.signature
  );
  assert.equal(
    (await fetch(
      `${running.baseUrl}/customs/declarations`,
      paidInit(firstQuote.quote.quoteId, firstHeader)
    )).status,
    402
  );
  assert.equal(
    (await fetch(
      `${running.baseUrl}/customs/declarations`,
      paidInit(secondQuote.quote.quoteId, secondHeader)
    )).status,
    402
  );

  const rejected = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(thirdQuote.quote.quoteId, thirdHeader)
  );
  assert.equal(rejected.status, 503);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
  assert.equal(running.quoteStore.getOrThrow(thirdQuote.quote.quoteId).status, "OPEN");
});

test("payment reservations atomically limit concurrent different payments", async (t) => {
  const facilitator = new FakeFacilitator();
  const running = await start(facilitator, undefined, undefined, 1);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const first = paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(firstQuote.quote.quoteId)
  );
  const second = paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(secondQuote.quote.quoteId)
  );
  const responses = await Promise.all([first, second]);
  assert.deepEqual(responses.map(response => response.status).sort(), [200, 503]);
  assert.equal(facilitator.events.filter(event => event === "verify").length, 1);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 1);
  const records = [
    running.quoteStore.getOrThrow(firstQuote.quote.quoteId),
    running.quoteStore.getOrThrow(secondQuote.quote.quoteId)
  ];
  assert.equal(records.filter(record => record.status === "FILED").length, 1);
  assert.equal(records.filter(record => record.status === "OPEN").length, 1);
});

test("terminal settlement failure releases the reservation slot", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: false,
    errorReason: "insufficient_funds",
    transaction: "",
    network,
    payer: buyer.address
  };
  const running = await start(facilitator, undefined, undefined, 1);
  t.after(() => close(running.server));
  const firstQuote = await createQuote(running.baseUrl);
  const secondQuote = await createQuote(running.baseUrl);
  const firstHeader = await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId);
  const secondHeader = await createSinglePaymentHeader(running.baseUrl, secondQuote.quote.quoteId);
  const paidInit = (quoteId: string, paymentHeader: string): RequestInit => ({
    ...declarationInit(quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  });

  const failed = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(firstQuote.quote.quoteId, firstHeader)
  );
  assert.equal(failed.status, 402);
  assert.equal(running.quoteStore.getOrThrow(firstQuote.quote.quoteId).status, "OPEN");

  facilitator.settleResponse = {
    success: true,
    transaction,
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const retried = await fetch(
    `${running.baseUrl}/customs/declarations`,
    paidInit(secondQuote.quote.quoteId, secondHeader)
  );
  assert.equal(retried.status, 200);
  assert.equal(running.quoteStore.getOrThrow(secondQuote.quote.quoteId).status, "FILED");
  assert.equal(facilitator.events.filter(event => event === "verify").length, 2);
  assert.equal(facilitator.events.filter(event => event === "settle").length, 2);
});

test("beforeVerify sweeps all expired malformed tombstones globally", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleResponse = {
    success: true,
    transaction: "not-a-transaction",
    network,
    payer: buyer.address,
    amount: "10000"
  };
  const realNow = Date.now;
  let now = 1_800_000_000_000;
  Date.now = () => now;
  try {
    const running = await start(facilitator, undefined, undefined, 2);
    t.after(() => close(running.server));
    const firstQuote = await createQuote(running.baseUrl);
    const secondQuote = await createQuote(running.baseUrl);
    const thirdQuote = await createQuote(running.baseUrl);
    const firstHeader = await createSinglePaymentHeader(running.baseUrl, firstQuote.quote.quoteId);
    const secondHeader = await createSinglePaymentHeader(running.baseUrl, secondQuote.quote.quoteId);
    const thirdHeader = await createSinglePaymentHeader(running.baseUrl, thirdQuote.quote.quoteId);
    const paidInit = (quoteId: string, paymentHeader: string): RequestInit => ({
      ...declarationInit(quoteId),
      headers: {
        "content-type": "application/json",
        "payment-signature": paymentHeader
      }
    });

    assert.equal(
      (await fetch(
        `${running.baseUrl}/customs/declarations`,
        paidInit(firstQuote.quote.quoteId, firstHeader)
      )).status,
      402
    );
    assert.equal(
      (await fetch(
        `${running.baseUrl}/customs/declarations`,
        paidInit(secondQuote.quote.quoteId, secondHeader)
      )).status,
      402
    );
    now += 301_000;

    const afterExpiry = await fetch(
      `${running.baseUrl}/customs/declarations`,
      paidInit(thirdQuote.quote.quoteId, thirdHeader)
    );
    assert.equal(afterExpiry.status, 402);
    assert.equal(running.quoteStore.getOrThrow(firstQuote.quote.quoteId).status, "OPEN");
    assert.equal(running.quoteStore.getOrThrow(secondQuote.quote.quoteId).status, "OPEN");
    assert.equal(facilitator.events.filter(event => event === "verify").length, 3);
    assert.equal(facilitator.events.filter(event => event === "settle").length, 3);
  } finally {
    Date.now = realNow;
  }
});

test("facilitator transport errors fail closed and block quote retries", async (t) => {
  const facilitator = new FakeFacilitator();
  facilitator.settleError = new FacilitatorTimeoutError("settle", brokerConfig.facilitatorTimeoutMs);
  const running = await start(facilitator);
  t.after(() => close(running.server));
  const { quote } = await createQuote(running.baseUrl);
  const paymentHeader = await createSinglePaymentHeader(running.baseUrl, quote.quoteId);
  const signedInit = {
    ...declarationInit(quote.quoteId),
    headers: {
      "content-type": "application/json",
      "payment-signature": paymentHeader
    }
  } satisfies RequestInit;
  const response = await fetch(
    `${running.baseUrl}/customs/declarations`,
    signedInit
  );
  assert.equal(response.status, 502);
  assert.equal(running.quoteStore.getOrThrow(quote.quoteId).status, "PROCESSING");
  const samePaymentRetry = await fetch(
    `${running.baseUrl}/customs/declarations`,
    signedInit
  );
  assert.equal(samePaymentRetry.status, 409);
  const newSignatureRetry = await paidFetch()(
    `${running.baseUrl}/customs/declarations`,
    declarationInit(quote.quoteId)
  );
  assert.equal(newSignatureRetry.status, 409);
  assert.equal(running.facilitator.events.filter(event => event === "settle").length, 1);
});

test("broker configuration rejects unsafe network and receiving address", () => {
  assert.throws(
    () => createApp({
      config: { ...brokerConfig, network: "eip155:8453" },
      facilitatorClient: new FakeFacilitator()
    }),
    /X402_NETWORK/
  );
  assert.throws(
    () => createApp({
      config: { ...brokerConfig, address: "0x0000000000000000000000000000000000000000" },
      facilitatorClient: new FakeFacilitator()
    }),
    /CUSTOMS_BROKER_ADDRESS/
  );
  for (const feeUsdc of [0, -0.01, 0.0100001, 1_000_000_000.000001]) {
    assert.throws(
      () => createApp({
        config: { ...brokerConfig, feeUsdc },
        facilitatorClient: new FakeFacilitator()
      }),
      /CUSTOMS_BROKER_FEE_USDC/
    );
  }
});
