import assert from "node:assert/strict";
import { test } from "node:test";
import { encodePaymentRequiredHeader } from "@x402/core/http";
import type { PaymentRequired } from "@x402/core/types";
import { privateKeyToAccount } from "viem/accounts";

const privateKey = "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d";
const importerAddress = privateKeyToAccount(privateKey).address;
const brokerAddress = "0x2222222222222222222222222222222222222222";
const environmentKeys = [
  "IMPORTER_ADDRESS",
  "IMPORTER_PRIVATE_KEY",
  "CUSTOMS_BROKER_ADDRESS",
  "X402_NETWORK",
  "CUSTOMS_BROKER_FEE_USDC",
  "MAX_PAYMENT_USDC"
] as const;
const previousEnvironment = new Map(environmentKeys.map(key => [key, process.env[key]]));

process.env.IMPORTER_ADDRESS = importerAddress;
process.env.IMPORTER_PRIVATE_KEY = privateKey;
process.env.CUSTOMS_BROKER_ADDRESS = brokerAddress;
process.env.X402_NETWORK = "eip155:84532";
process.env.CUSTOMS_BROKER_FEE_USDC = "0.01";
process.env.MAX_PAYMENT_USDC = "1";

const { createX402PaidFetch } = await import("../src/payment/client.js");

for (const key of environmentKeys) {
  const value = previousEnvironment.get(key);
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
}

test("x402 paid fetch rejects concurrent requests to protect dispatch tracking", async () => {
  const originalFetch = globalThis.fetch;
  let resolveStarted!: () => void;
  const started = new Promise<void>(resolve => { resolveStarted = resolve; });
  let resolveResponse!: (response: Response) => void;
  const response = new Promise<Response>(resolve => { resolveResponse = resolve; });
  let calls = 0;
  const blockedFetch: typeof globalThis.fetch = async () => {
    calls += 1;
    resolveStarted();
    return response;
  };
  globalThis.fetch = blockedFetch;

  try {
    const paidFetch = await createX402PaidFetch();
    const first = paidFetch("http://broker.test");
    await started;
    await assert.rejects(
      () => paidFetch("http://broker.test"),
      /Concurrent x402 payment requests are not supported/
    );
    resolveResponse(new Response("upstream failure", { status: 503 }));
    assert.equal((await first).status, 503);
    assert.equal(calls, 1);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("x402 paid fetch rejects a high-price challenge without dispatching payment", async () => {
  const originalFetch = globalThis.fetch;
  let calls = 0;
  let signedCalls = 0;
  const paymentRequired: PaymentRequired = {
    x402Version: 2,
    resource: { url: "http://broker.test/customs/declarations" },
    accepts: [{
      scheme: "exact",
      network: "eip155:84532",
      asset: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
      amount: "20000",
      payTo: brokerAddress,
      maxTimeoutSeconds: 300,
      extra: {}
    }]
  };
  globalThis.fetch = async (input, init) => {
    calls += 1;
    const request = input instanceof Request ? input : new Request(input, init);
    if (request.headers.has("payment-signature") || request.headers.has("x-payment")) {
      signedCalls += 1;
    }
    return new Response("payment required", {
      status: 402,
      headers: { "payment-required": encodePaymentRequiredHeader(paymentRequired) }
    });
  };

  try {
    const paidFetch = await createX402PaidFetch();
    await assert.rejects(
      () => paidFetch("http://broker.test/customs/declarations"),
      /filtered out by policies/
    );
    assert.equal(calls, 1);
    assert.equal(signedCalls, 0);
    assert.equal(paidFetch.getPaymentDispatchState(), false);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
