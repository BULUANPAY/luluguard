import type { AgentPolicy } from "../domain.js";
import { z } from "zod";

export type AgentStatus = "ACTIVE" | "PAYMENT_PAUSED" | "DISABLED";

export interface RuntimePolicy extends Omit<AgentPolicy, "status" | "maxDailySpendUsd" | "maxPaymentsPerHour"> {
  status: AgentStatus;
  maxDailySpendUsd: number;
  maxPaymentsPerHour: number;
  version: number;
  updatedAt: string;
}

const evmAddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
const policyFields = {
  status: z.enum(["ACTIVE", "PAYMENT_PAUSED", "DISABLED"]),
  maxPaymentUsd: z.number().finite().nonnegative(),
  maxDailySpendUsd: z.number().finite().nonnegative(),
  maxPaymentsPerHour: z.number().int().positive(),
  requireHumanApprovalAboveUsd: z.number().finite().nonnegative(),
  allowedPayees: z.array(evmAddressSchema).min(1),
};
const runtimePolicyInputSchema = z.object(policyFields).strict();
const policyUpdateSchema = z
  .object({
    status: policyFields.status.optional(),
    maxPaymentUsd: policyFields.maxPaymentUsd.optional(),
    maxDailySpendUsd: policyFields.maxDailySpendUsd.optional(),
    maxPaymentsPerHour: policyFields.maxPaymentsPerHour.optional(),
    requireHumanApprovalAboveUsd:
      policyFields.requireHumanApprovalAboveUsd.optional(),
    allowedPayees: policyFields.allowedPayees.optional(),
  })
  .strict();

export type PolicyUpdate = z.infer<typeof policyUpdateSchema>;

function invalidPolicy(label: string, error: z.ZodError): Error {
  const details = error.issues
    .map((issue) => `${issue.path.join(".") || "policy"}: ${issue.message}`)
    .join("; ");
  return new Error(`${label}: ${details}`);
}

function normalizedPolicy(input: unknown) {
  const parsed = runtimePolicyInputSchema.safeParse(input);
  if (!parsed.success) throw invalidPolicy("Invalid initial policy", parsed.error);
  return {
    ...parsed.data,
    allowedPayees: [
      ...new Set(parsed.data.allowedPayees.map((address) => address.toLowerCase())),
    ],
  };
}

export class PolicyStore {
  private state: RuntimePolicy;

  constructor(initial: AgentPolicy) {
    const policy = normalizedPolicy({
      ...initial,
      maxDailySpendUsd: initial.maxDailySpendUsd ?? initial.maxPaymentUsd,
      maxPaymentsPerHour: initial.maxPaymentsPerHour ?? 1,
      status: initial.status ?? "ACTIVE",
    });
    this.state = {
      ...policy,
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

  update(update: unknown): { previous: RuntimePolicy; current: RuntimePolicy } {
    const parsed = policyUpdateSchema.safeParse(update);
    if (!parsed.success) throw invalidPolicy("Invalid policy update", parsed.error);
    const previous = this.get();
    const {
      version: _version,
      updatedAt: _updatedAt,
      ...currentPolicy
    } = this.state;
    void _version;
    void _updatedAt;
    const next = normalizedPolicy({ ...currentPolicy, ...parsed.data });
    this.state = {
      ...next,
      version: previous.version + 1,
      updatedAt: new Date().toISOString()
    };
    return { previous, current: this.get() };
  }
}
