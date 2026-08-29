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
