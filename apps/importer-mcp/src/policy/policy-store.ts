import type { AgentPolicy } from "../domain.js";

export type AgentStatus = "ACTIVE" | "PAYMENT_PAUSED" | "DISABLED";

export interface RuntimePolicy extends Omit<AgentPolicy, "status" | "maxDailySpendUsd" | "maxPaymentsPerHour"> {
  status: AgentStatus;
  maxDailySpendUsd: number;
  maxPaymentsPerHour: number;
  version: number;
  updatedAt: string;
}

export type PolicyUpdate = Partial<Pick<RuntimePolicy,
  "status" | "maxPaymentUsd" | "maxDailySpendUsd" | "maxPaymentsPerHour" |
  "requireHumanApprovalAboveUsd" | "allowedPayees"
>>;

export class PolicyStore {
  private state: RuntimePolicy;

  constructor(initial: AgentPolicy) {
    this.state = {
      ...initial,
      maxDailySpendUsd: initial.maxDailySpendUsd ?? initial.maxPaymentUsd,
      maxPaymentsPerHour: initial.maxPaymentsPerHour ?? 1,
      status: "ACTIVE",
      version: 1,
      updatedAt: new Date().toISOString()
    };
  }

  get(): RuntimePolicy {
    return structuredClone(this.state);
  }

  paymentPolicy(): AgentPolicy {
    const { version: _version, updatedAt: _updatedAt, ...policy } = this.state;
    void _version;
    void _updatedAt;
    return policy;
  }

  assertAgentEnabled() {
    if (this.state.status === "DISABLED") throw new Error("AI Agent is disabled by administrator policy");
  }

  assertPaymentEnabled() {
    if (this.state.status !== "ACTIVE") {
      throw new Error(`AI Agent payment is blocked while policy status is ${this.state.status}`);
    }
  }

  update(update: PolicyUpdate): { previous: RuntimePolicy; current: RuntimePolicy } {
    const previous = this.get();
    const next = { ...this.state, ...update };
    const numericValues = [
      next.maxPaymentUsd,
      next.maxDailySpendUsd,
      next.maxPaymentsPerHour,
      next.requireHumanApprovalAboveUsd
    ];
    if (numericValues.some(value => value === undefined || !Number.isFinite(value) || value < 0)) {
      throw new Error("Policy limits must be finite non-negative numbers");
    }
    if (!Number.isInteger(next.maxPaymentsPerHour) || next.maxPaymentsPerHour < 1) {
      throw new Error("maxPaymentsPerHour must be a positive integer");
    }
    if (!next.allowedPayees.length || next.allowedPayees.some(address => !/^0x[0-9a-fA-F]{40}$/.test(address))) {
      throw new Error("allowedPayees must contain valid EVM addresses");
    }
    this.state = {
      ...next,
      allowedPayees: [...new Set(next.allowedPayees.map(address => address.toLowerCase()))],
      version: previous.version + 1,
      updatedAt: new Date().toISOString()
    };
    return { previous, current: this.get() };
  }
}
