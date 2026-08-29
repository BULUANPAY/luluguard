import assert from "node:assert/strict";
import { test } from "node:test";
import { ImporterAgent } from "../src/importer-agent.js";
import type { DutyQuote } from "../src/domain.js";

const importerAddress = "0x1111111111111111111111111111111111111111";
const brokerAddress = "0x2222222222222222222222222222222222222222";
const quoteId = "QUOTE-TEST";
const quote: DutyQuote = {
  quoteId,
  expiresAt: new Date(Date.now() + 60_000).toISOString(),
  declarationId: "DECL-INV-TEST-001",
  customsValueUsd: 1200,
  dutyUsd: 60,
  taxUsd: 63,
  filingFeeUsd: 2,
  customsBrokerFeeUsd: 0.01,
  totalEstimatedUsd: 125.01
};

function freeQuoteFetch(): typeof globalThis.fetch {
  return async () => new Response(JSON.stringify({ quote }), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}

function fakePaidFetch(onCall?: () => void): typeof globalThis.fetch {
  return async () => {
    onCall?.();
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
    }), { status: 200, headers: { "content-type": "application/json" } });
  };
}

function createAgent(
  policy = { maxPaymentUsd: 1, allowedPayees: [brokerAddress], requireHumanApprovalAboveUsd: 0 },
  paidFetch = fakePaidFetch()
) {
  return new ImporterAgent(
    "http://broker.test",
    policy,
    freeQuoteFetch(),
    paidFetch,
    0.01,
    brokerAddress,
    importerAddress
  );
}

test("quote is returned without calling the paid fetch", async () => {
  let paid = false;
  const result = await createAgent(undefined, fakePaidFetch(() => { paid = true; })).getQuote("TEST-001");
  assert.equal(result.quote.quoteId, quoteId);
  assert.equal(result.quote.totalEstimatedUsd, 125.01);
  assert.equal(paid, false);
});

test("approved declaration uses the quote and paid fetch", async () => {
  const result = await createAgent().submit("TEST-001", quoteId, true);
  assert.equal(result.receipt.status, "filed");
  assert.equal(result.quote.quoteId, quoteId);
});

test("payment policy blocks unapproved submission", async () => {
  await assert.rejects(() => createAgent().submit("TEST-002", quoteId, false), /Human approval required/);
});

test("hard spending limit blocks payment even when approved", async () => {
  const agent = createAgent({
    maxPaymentUsd: 0.005,
    allowedPayees: [brokerAddress],
    requireHumanApprovalAboveUsd: 0
  });
  await assert.rejects(() => agent.submit("TEST-003", quoteId, true), /exceeds maximum/);
});

test("importer and customs broker may use the same address", async () => {
  const agent = new ImporterAgent(
    "http://broker.test",
    { maxPaymentUsd: 1, allowedPayees: [importerAddress], requireHumanApprovalAboveUsd: 0 },
    freeQuoteFetch(),
    fakePaidFetch(),
    0.01,
    importerAddress,
    importerAddress
  );
  const result = await agent.submit("TEST-SAME", quoteId, true);
  assert.equal(result.receipt.status, "filed");
});
