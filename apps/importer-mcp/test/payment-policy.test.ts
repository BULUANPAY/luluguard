import assert from "node:assert/strict";
import { test } from "node:test";
import {
  evaluatePaymentPolicy,
  PaymentReservationError,
  PaymentReservationStore,
  type PaymentRecord
} from "../src/payment/policy.js";
import { requireAddress } from "../src/payment/signer.js";

const payee = "0x2222222222222222222222222222222222222222";
const policy = {
  maxPaymentUsd: 1,
  maxDailySpendUsd: 2,
  maxPaymentsPerHour: 2,
  allowedPayees: [payee],
  requireHumanApprovalAboveUsd: 0
};

test("allows an approved payment within every policy limit", () => {
  const decision = evaluatePaymentPolicy(policy, 0.01, payee, true, []);
  assert.equal(decision.allowed, true);
  assert.deepEqual(decision.reasonCodes, []);
  assert.match(decision.auditId, /^PAY-/);
});

test("returns stable reason codes for blocked payment requests", () => {
  const history: PaymentRecord[] = [
    { timestamp: new Date().toISOString(), amountUsdc: 1.5, payee, quoteId: "Q1", receiptId: "R1" },
    { timestamp: new Date().toISOString(), amountUsdc: 0.25, payee, quoteId: "Q2", receiptId: "R2" }
  ];
  const decision = evaluatePaymentPolicy(policy, 1.1, "0x3333333333333333333333333333333333333333", false, history);
  assert.equal(decision.allowed, false);
  assert.deepEqual(decision.reasonCodes.sort(), [
    "DAILY_LIMIT_EXCEEDED",
    "HOURLY_PAYMENT_COUNT_EXCEEDED",
    "HUMAN_APPROVAL_REQUIRED",
    "PAYEE_NOT_ALLOWED",
    "PER_PAYMENT_LIMIT_EXCEEDED"
  ]);
});

test("payment pause and agent disable are enforced by the payment gate", () => {
  assert.deepEqual(
    evaluatePaymentPolicy({ ...policy, status: "PAYMENT_PAUSED" }, 0.01, payee, true, []).reasonCodes,
    ["PAYMENT_PAUSED"]
  );
  assert.deepEqual(
    evaluatePaymentPolicy({ ...policy, status: "DISABLED" }, 0.01, payee, true, []).reasonCodes,
    ["AGENT_DISABLED"]
  );
});

test("zero addresses are rejected before signer setup", () => {
  assert.throws(
    () => requireAddress("CUSTOMS_BROKER_ADDRESS", "0x0000000000000000000000000000000000000000"),
    /valid EVM address/
  );
});

test("a quote cannot have more than one active or ambiguous reservation", () => {
  const store = new PaymentReservationStore();
  const first = store.reserve(policy, 0.01, payee, true, [], "QUOTE-RESERVATION");

  assert.throws(
    () => store.reserve(policy, 0.01, payee, true, [], "QUOTE-RESERVATION"),
    error => {
      assert.ok(error instanceof PaymentReservationError);
      assert.equal(error.reasonCode, "PAYMENT_ALREADY_IN_FLIGHT");
      return true;
    }
  );

  store.holdAmbiguous(first.reservationId);
  assert.throws(
    () => store.reserve(policy, 0.01, payee, true, [], "QUOTE-RESERVATION"),
    /PAYMENT_ALREADY_IN_FLIGHT/
  );
});
