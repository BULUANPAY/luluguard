import assert from "node:assert/strict";
import { createServer as createHttpServer, type Server } from "node:http";
import { test } from "node:test";
import { encodePaymentResponseHeader } from "@x402/core/http";
import type { SettleResponse } from "@x402/core/types";
import {
  ImporterAgent,
  type SettlementReconciliationRecord,
} from "../src/importer-agent.js";
import { config } from "../src/config.js";
import type { DutyQuote } from "../src/domain.js";
import {
  createApp,
  createImporterServerStores,
  type ImporterServerStores,
} from "../src/mcp-server.js";
import type { PaymentDispatchAwareFetch } from "../src/payment/client.js";

const adminKey = "admin-test-key";
const network = "eip155:84532" as const;

function createQuote(quoteId: string, orderId: string): DutyQuote {
  const brokerFee = config.customsBroker.feeUsdc;
  return {
    quoteId,
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    declarationId: `DECL-${orderId}`,
    goodsValueUsd: 1200,
    freightUsd: 80,
    insuranceUsd: 12,
    customsValueUsd: 1292,
    appliedDutyRatePercent: 5,
    tariffBasis: "mock-tariff-profile",
    dutyUsd: 64.6,
    taxUsd: 67.83,
    tradePromotionFeeUsd: 0.52,
    filingFeeUsd: 2,
    customsBrokerFeeUsd: brokerFee,
    totalEstimatedUsd: Number((64.6 + 67.83 + 0.52 + 2 + brokerFee).toFixed(6)),
  };
}

async function seedReconciliation(): Promise<{
  stores: ImporterServerStores;
  record: SettlementReconciliationRecord;
  orderId: string;
  quoteId: string;
}> {
  const stores = createImporterServerStores();
  const orderId = "ORDER-ADMIN-TEST";
  const quoteId = "QUOTE-ADMIN-TEST";
  const quote = createQuote(quoteId, orderId);
  const quoteFetch: typeof globalThis.fetch = async () =>
    new Response(JSON.stringify({ quote }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  const pendingSettlement: SettleResponse = {
    success: false,
    errorReason: "settlement_pending",
    transaction: `0x${"b".repeat(64)}`,
    network,
  };
  const paidFetch: PaymentDispatchAwareFetch = Object.assign(
    (async () =>
      new Response("{}", {
        status: 402,
        headers: {
          "content-type": "application/json",
          "payment-response": encodePaymentResponseHeader(pendingSettlement),
        },
      })) as typeof globalThis.fetch,
    { getPaymentDispatchState: () => true },
  );
  const agent = new ImporterAgent(
    config.customsBroker.apiUrl,
    stores.policyStore.paymentPolicy(),
    quoteFetch,
    paidFetch,
    config.customsBroker.feeUsdc,
    config.customsBroker.address,
    config.importer.address,
    stores.preflightStore,
    stores.quoteStore,
    stores.paymentHistory,
    network,
    stores.settlementReconciliationStore,
    stores.paymentReservationStore,
  );
  const preflight = agent.precheck(orderId);
  await agent.getQuote(preflight.preflightId, true);
  await assert.rejects(
    () => agent.submit(orderId, quoteId, true),
    /settlement_pending/,
  );
  const record = agent.getSettlementReconciliation(quoteId);
  assert.ok(record);
  return { stores, record, orderId, quoteId };
}

async function withServer<T>(
  app: ReturnType<typeof createApp>,
  callback: (baseUrl: string) => Promise<T>,
) {
  const server: Server = createHttpServer(app);
  await new Promise<void>((resolve, reject) => {
    server.listen(0, "127.0.0.1", () => resolve());
    server.once("error", reject);
  });
  const address = server.address();
  assert.ok(address && typeof address === "object");
  try {
    return await callback(`http://127.0.0.1:${address.port}`);
  } finally {
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

function adminHeaders() {
  return { Authorization: `Bearer ${adminKey}` };
}

test("reconciliation admin routes require the policy admin Bearer key", async () => {
  const { stores, quoteId } = await seedReconciliation();
  const app = createApp({ stores, policyAdminApiKey: adminKey });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/reconciliation/${quoteId}`);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: "Unauthorized" });
  });
});

test("GET returns a reconciliation record and 404 for an unknown quote", async () => {
  const { stores, quoteId, record } = await seedReconciliation();
  const app = createApp({ stores, policyAdminApiKey: adminKey });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/reconciliation/${quoteId}`, {
      headers: adminHeaders(),
    });
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), record);

    const missing = await fetch(
      `${baseUrl}/admin/reconciliation/QUOTE-NOT-FOUND`,
      { headers: adminHeaders() },
    );
    assert.equal(missing.status, 404);
  });
});

test("terminal failed settlement resolves only the current reconciliation owner", async () => {
  const { stores, quoteId, orderId, record } = await seedReconciliation();
  const app = createApp({ stores, policyAdminApiKey: adminKey });
  const terminalFailure: SettleResponse = {
    success: false,
    errorReason: "INSUFFICIENT_FUNDS",
    transaction:
      "0xcccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccccc",
    network,
  };
  await withServer(app, async (baseUrl) => {
    const wrongAttempt = await fetch(
      `${baseUrl}/admin/reconciliation/resolve`,
      {
        method: "POST",
        headers: { ...adminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          quoteId,
          attemptId: "ATTEMPT-WRONG",
          settlement: terminalFailure,
        }),
      },
    );
    assert.equal(wrongAttempt.status, 409);

    const mismatched = await fetch(`${baseUrl}/admin/reconciliation/resolve`, {
      method: "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        quoteId,
        attemptId: record.attemptId,
        settlement: terminalFailure,
      }),
    });
    assert.equal(mismatched.status, 400);
    assert.match((await mismatched.json()).error, /transaction.*recorded/i);
    const stillPending = await fetch(
      `${baseUrl}/admin/reconciliation/${quoteId}`,
      { headers: adminHeaders() },
    );
    assert.equal(stillPending.status, 200);
    assert.notDeepEqual(stores.paymentReservationStore.listForQuote(quoteId), []);

    const resolved = await fetch(`${baseUrl}/admin/reconciliation/resolve`, {
      method: "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        quoteId,
        attemptId: record.attemptId,
        settlement: {
          ...terminalFailure,
          transaction: record.settlement?.transaction,
        },
      }),
    });
    assert.equal(resolved.status, 200);
    const body = (await resolved.json()) as {
      resolved: boolean;
      reconciliation: SettlementReconciliationRecord;
    };
    assert.equal(body.resolved, true);
    assert.deepEqual(body.reconciliation, record);

    const afterResolve = await fetch(
      `${baseUrl}/admin/reconciliation/${quoteId}`,
      { headers: adminHeaders() },
    );
    assert.equal(afterResolve.status, 404);
    assert.deepEqual(stores.paymentReservationStore.listForQuote(quoteId), []);
  });
});

test("successful and pending settlements cannot resolve a reconciliation", async () => {
  for (const settlement of [
    {
      success: true,
      transaction:
        "0xdddddddddddddddddddddddddddddddddddddddddddddddddddddddddddd",
      network,
    },
    {
      success: false,
      errorReason: "settlement_pending",
      transaction:
        "0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee",
      network,
    },
  ] satisfies SettleResponse[]) {
    const { stores, quoteId, orderId, record } = await seedReconciliation();
    const app = createApp({ stores, policyAdminApiKey: adminKey });
    await withServer(app, async (baseUrl) => {
      const response = await fetch(`${baseUrl}/admin/reconciliation/resolve`, {
        method: "POST",
        headers: { ...adminHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          orderId,
          quoteId,
          attemptId: record.attemptId,
          settlement,
        }),
      });
      assert.equal(response.status, 400);
      assert.match(
        (await response.json()).error,
        /terminal|settlement_pending/i,
      );

      const stillPending = await fetch(
        `${baseUrl}/admin/reconciliation/${quoteId}`,
        { headers: adminHeaders() },
      );
      assert.equal(stillPending.status, 200);
    });
  }
});

test("reconciliation delegates network and amount validation to ImporterAgent", async () => {
  const { stores, quoteId, orderId, record } = await seedReconciliation();
  const app = createApp({ stores, policyAdminApiKey: adminKey });
  await withServer(app, async (baseUrl) => {
    const response = await fetch(`${baseUrl}/admin/reconciliation/resolve`, {
      method: "POST",
      headers: { ...adminHeaders(), "Content-Type": "application/json" },
      body: JSON.stringify({
        orderId,
        quoteId,
        attemptId: record.attemptId,
        settlement: {
          success: false,
          errorReason: "SETTLEMENT_FAILED",
          transaction:
            "0xffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffffff",
          network: "eip155:1",
          amount: "10001",
        },
      }),
    });
    assert.equal(response.status, 400);
    assert.match((await response.json()).error, /network/);
  });
});
