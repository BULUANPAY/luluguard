import assert from "node:assert/strict";
import { test } from "node:test";
import { PolicyStore } from "../src/policy/policy-store.js";

const address = "0x2222222222222222222222222222222222222222";

test("runtime policy updates immediately and increments its version", () => {
  const store = new PolicyStore({
    maxPaymentUsd: 1,
    maxDailySpendUsd: 5,
    maxPaymentsPerHour: 5,
    requireHumanApprovalAboveUsd: 0,
    allowedPayees: [address]
  });
  const changed = store.update({ status: "PAYMENT_PAUSED", maxPaymentUsd: 0.5 });
  assert.equal(changed.previous.version, 1);
  assert.equal(changed.current.version, 2);
  assert.equal(store.paymentPolicy().status, "PAYMENT_PAUSED");
  assert.equal(store.paymentPolicy().maxPaymentUsd, 0.5);
});

test("disabled policy blocks non-payment agent operations", () => {
  const store = new PolicyStore({
    maxPaymentUsd: 1,
    requireHumanApprovalAboveUsd: 0,
    allowedPayees: [address]
  });
  store.update({ status: "DISABLED" });
  assert.throws(() => store.assertAgentEnabled(), /disabled by administrator/);
  assert.throws(() => store.assertPaymentEnabled(), /policy status is DISABLED/);
});

test("preserves the initial policy status", () => {
  const store = new PolicyStore({
    status: "DISABLED",
    maxPaymentUsd: 1,
    requireHumanApprovalAboveUsd: 0,
    allowedPayees: [address]
  });

  assert.equal(store.get().status, "DISABLED");
  assert.throws(() => store.assertAgentEnabled(), /disabled by administrator/);
});

test("rejects invalid initial limits before policy enforcement starts", () => {
  assert.throws(
    () =>
      new PolicyStore({
        maxPaymentUsd: Number.NaN,
        requireHumanApprovalAboveUsd: 0,
        allowedPayees: [address],
      }),
    /Invalid initial policy.*maxPaymentUsd/,
  );
});

test("rejects invalid statuses and unknown policy update fields", () => {
  const store = new PolicyStore({
    maxPaymentUsd: 1,
    requireHumanApprovalAboveUsd: 0,
    allowedPayees: [address],
  });

  assert.throws(
    () => store.update({ status: "UNKNOWN" }),
    /Invalid policy update.*status/,
  );
  assert.throws(
    () => store.update({ maxPaymentUsd: 0.5, unexpected: true }),
    /Invalid policy update.*Unrecognized key/,
  );
  assert.equal(store.get().version, 1);
});
