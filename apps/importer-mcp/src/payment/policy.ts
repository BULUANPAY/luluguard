import type { AgentPolicy } from "../domain.js";

export function assertPaymentAllowed(
  policy: AgentPolicy,
  amount: number,
  brokerAddress: string,
  humanApproved: boolean
) {
  if (!policy.allowedPayees.some(address => address.toLowerCase() === brokerAddress.toLowerCase())) {
    throw new Error(`Payment blocked: payee ${brokerAddress} is not allowed`);
  }
  if (amount > policy.maxPaymentUsd) {
    throw new Error(`Payment blocked: ${amount} exceeds maximum ${policy.maxPaymentUsd}`);
  }
  if (amount > policy.requireHumanApprovalAboveUsd && !humanApproved) {
    throw new Error(`Human approval required: ${amount} exceeds ${policy.requireHumanApprovalAboveUsd}`);
  }
}

export function isAllowedPayee(actualPayee: string, expectedPayee: string) {
  return actualPayee.toLowerCase() === expectedPayee.toLowerCase();
}
