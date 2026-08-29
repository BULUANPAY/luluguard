import { randomUUID } from "node:crypto";
import type { AgentPolicy } from "../domain.js";

export type PaymentPolicyReason =
  | "AGENT_DISABLED"
  | "PAYMENT_PAUSED"
  | "INVALID_AMOUNT"
  | "PAYEE_NOT_ALLOWED"
  | "PER_PAYMENT_LIMIT_EXCEEDED"
  | "DAILY_LIMIT_EXCEEDED"
  | "HOURLY_PAYMENT_COUNT_EXCEEDED"
  | "HUMAN_APPROVAL_REQUIRED";

export interface PaymentRecord {
  timestamp: string;
  amountUsdc: number;
  payee: string;
  quoteId: string;
  receiptId: string;
}

export interface PaymentPolicyDecision {
  auditId: string;
  allowed: boolean;
  reasonCodes: PaymentPolicyReason[];
  amountUsdc: number;
  payee: string;
  humanApproved: boolean;
  spentLast24HoursUsdc: number;
  paymentsLastHour: number;
  limits: {
    perPaymentUsdc: number;
    dailyUsdc: number;
    paymentsPerHour: number;
    humanApprovalAboveUsdc: number;
  };
}

export class PaymentPolicyError extends Error {
  constructor(readonly decision: PaymentPolicyDecision) {
    super(`Payment blocked by policy: ${decision.reasonCodes.join(", ")}`);
  }
}

export function evaluatePaymentPolicy(
  policy: AgentPolicy,
  amountUsdc: number,
  payee: string,
  humanApproved: boolean,
  history: PaymentRecord[],
  now = new Date()
): PaymentPolicyDecision {
  const reasonCodes: PaymentPolicyReason[] = [];
  const nowMs = now.getTime();
  const spentLast24HoursUsdc = Number(history
    .filter(record => nowMs - Date.parse(record.timestamp) < 86_400_000)
    .reduce((sum, record) => sum + record.amountUsdc, 0)
    .toFixed(6));
  const paymentsLastHour = history.filter(
    record => nowMs - Date.parse(record.timestamp) < 3_600_000
  ).length;
  const dailyLimit = policy.maxDailySpendUsd ?? policy.maxPaymentUsd;
  const hourlyLimit = policy.maxPaymentsPerHour ?? 1;

  if (policy.status === "DISABLED") reasonCodes.push("AGENT_DISABLED");
  if (policy.status === "PAYMENT_PAUSED") reasonCodes.push("PAYMENT_PAUSED");
  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) reasonCodes.push("INVALID_AMOUNT");
  if (!policy.allowedPayees.some(address => address.toLowerCase() === payee.toLowerCase())) {
    reasonCodes.push("PAYEE_NOT_ALLOWED");
  }
  if (amountUsdc > policy.maxPaymentUsd) reasonCodes.push("PER_PAYMENT_LIMIT_EXCEEDED");
  if (spentLast24HoursUsdc + amountUsdc > dailyLimit) reasonCodes.push("DAILY_LIMIT_EXCEEDED");
  if (paymentsLastHour >= hourlyLimit) reasonCodes.push("HOURLY_PAYMENT_COUNT_EXCEEDED");
  if (amountUsdc > policy.requireHumanApprovalAboveUsd && !humanApproved) {
    reasonCodes.push("HUMAN_APPROVAL_REQUIRED");
  }

  return {
    auditId: `PAY-${randomUUID()}`,
    allowed: reasonCodes.length === 0,
    reasonCodes,
    amountUsdc,
    payee,
    humanApproved,
    spentLast24HoursUsdc,
    paymentsLastHour,
    limits: {
      perPaymentUsdc: policy.maxPaymentUsd,
      dailyUsdc: dailyLimit,
      paymentsPerHour: hourlyLimit,
      humanApprovalAboveUsdc: policy.requireHumanApprovalAboveUsd
    }
  };
}

export function assertPaymentAllowed(
  policy: AgentPolicy,
  amount: number,
  brokerAddress: string,
  humanApproved: boolean,
  history: PaymentRecord[] = []
) {
  const decision = evaluatePaymentPolicy(policy, amount, brokerAddress, humanApproved, history);
  if (!decision.allowed) throw new PaymentPolicyError(decision);
  return decision;
}

export function isAllowedPayee(actualPayee: string, expectedPayee: string) {
  return actualPayee.toLowerCase() === expectedPayee.toLowerCase();
}
