import {
  VleiJsonSigning,
  type SignedJsonEnvelope,
} from "@repo/vlei-json-signing";
import { writeAudit } from "./audit.js";
import { config } from "./config.js";
import { z } from "zod";

export type AuthorizedWorkflowAction = "precheck" | "broker_quote" | "payment";

export interface VerifiedAgentAuthorization {
  tenantId: string;
  userId: string;
  employeeName: string;
  employeeRole: string;
  sessionId: string;
  agentRunId: string;
  authorizationId: string;
  signerAid: string;
  signerCredentialSaid: string;
  legalEntityLei: string;
  action: AuthorizedWorkflowAction;
}

const consumedNonces = new Set<string>();
const authorizationPayloadSchema = z.object({
  type: z.literal("LuLuGuardSandboxAgentAuthorization"),
  authorizationId: z.string().min(1),
  nonce: z.string().min(1),
  issuedAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
  tenantId: z.string().min(1),
  legalEntityLei: z.string().min(1),
  employeeId: z.string().min(1),
  sessionId: z.string().min(1),
  agentId: z.literal("luluguard-importer-agent"),
  agentVersion: z.literal("0.4.0"),
  agentRunId: z.string().min(1),
  traceId: z.string().min(1),
  action: z.enum(["precheck", "broker_quote", "payment"]),
  resource: z.record(z.unknown()),
});
const signerInfoSchema = z.object({
  employeeId: z.string().min(1),
  name: z.string().min(1),
  tenantId: z.string().min(1),
  lei: z.string().min(1),
  role: z.string().min(1),
  allowedActions: z.array(z.enum(["precheck", "broker_quote", "payment"])),
});

function sameStringArray(left: unknown, right: unknown): boolean {
  return (
    Array.isArray(left) &&
    Array.isArray(right) &&
    JSON.stringify([...left].sort()) === JSON.stringify([...right].sort())
  );
}

function assertResource(
  action: AuthorizedWorkflowAction,
  actual: Record<string, unknown>,
  expected: Record<string, unknown>,
) {
  const keys =
    action === "precheck"
      ? ["orderId"]
      : action === "broker_quote"
        ? ["preflightId", "estimateApproved"]
        : ["orderId", "quoteId", "humanApproved"];
  for (const key of keys) {
    const matches = Array.isArray(expected[key])
      ? sameStringArray(actual[key], expected[key])
      : actual[key] === expected[key];
    if (!matches)
      throw new Error(`vLEI authorization resource mismatch: ${key}`);
  }
}

export async function verifyAgentAuthorization(input: {
  authorization: unknown;
  traceId: string;
  action: AuthorizedWorkflowAction;
  resource: Record<string, unknown>;
}): Promise<VerifiedAgentAuthorization> {
  writeAudit({
    traceId: input.traceId,
    component: "vlei-authorization",
    action: "authorization.verify",
    status: "attempted",
    actor: "mcp-server",
    agentId: "luluguard-importer-agent",
    data: { expectedAction: input.action, expectedResource: input.resource },
  });
  const reject = (message: string, data?: unknown): never => {
    writeAudit({
      traceId: input.traceId,
      component: "vlei-authorization",
      action: "authorization.verify",
      status: "blocked",
      actor: "mcp-server",
      agentId: "luluguard-importer-agent",
      data: { reason: message, detail: data },
    });
    throw new Error(message);
  };
  if (!input.authorization || typeof input.authorization !== "object") {
    reject("A signed vLEI agent authorization is required");
  }
  if (!config.vlei.expectedRootAid) {
    return reject("VLEI_EXPECTED_ROOT_AID is not configured");
  }
  let result;
  try {
    result = await VleiJsonSigning.verifyJson(
      input.authorization as SignedJsonEnvelope,
      {
        expectedRootAid: config.vlei.expectedRootAid,
        expectedLei: config.importer.lei,
      },
    );
  } catch (error) {
    return reject("vLEI package verification failed", error);
  }
  if (!result.valid) {
    writeAudit({
      traceId: input.traceId,
      component: "vlei-authorization",
      action: "authorization.verify",
      status: "failed",
      actor: "mcp-server",
      agentId: "luluguard-importer-agent",
      data: { errors: result.errors },
    });
    return reject(
      "vLEI agent authorization signature or credential is invalid",
      result.errors,
    );
  }

  const parsedPayload = authorizationPayloadSchema.safeParse(result.payload);
  if (!parsedPayload.success) {
    return reject(
      "vLEI authorization payload is invalid",
      parsedPayload.error.flatten(),
    );
  }
  const payload = parsedPayload.data;
  const parsedSignerInfo = signerInfoSchema.safeParse(result.signer.info);
  if (!parsedSignerInfo.success) {
    return reject(
      "vLEI signer credential information is invalid",
      parsedSignerInfo.error.flatten(),
    );
  }
  const signerInfo = parsedSignerInfo.data;
  if (payload.type !== "LuLuGuardSandboxAgentAuthorization")
    reject("Unsupported authorization type");
  if (payload.traceId !== input.traceId)
    reject("vLEI authorization traceId mismatch");
  if (
    payload.agentId !== "luluguard-importer-agent" ||
    payload.agentVersion !== "0.4.0"
  ) {
    reject("vLEI authorization targets a different agent");
  }
  if (payload.action !== input.action)
    reject("vLEI authorization action mismatch");
  if (
    Date.parse(payload.issuedAt) > Date.now() + 30_000 ||
    Date.parse(payload.expiresAt) <= Date.now()
  ) {
    reject("vLEI authorization is not currently valid");
  }
  if (consumedNonces.has(payload.nonce))
    reject("vLEI authorization has already been used");
  if (
    payload.employeeId !== signerInfo.employeeId ||
    payload.tenantId !== signerInfo.tenantId ||
    payload.legalEntityLei !== result.lei ||
    signerInfo.lei !== result.lei
  ) {
    reject("vLEI employee or legal entity binding mismatch");
  }
  if (
    !signerInfo.allowedActions.includes(input.action)
  ) {
    reject(`Employee vLEI role is not authorized for ${input.action}`);
  }
  try {
    assertResource(input.action, payload.resource, input.resource);
  } catch (error) {
    reject(
      error instanceof Error
        ? error.message
        : "vLEI authorization resource mismatch",
    );
  }
  consumedNonces.add(payload.nonce);

  const verified: VerifiedAgentAuthorization = {
    tenantId: payload.tenantId,
    userId: payload.employeeId,
    employeeName: signerInfo.name ?? payload.employeeId,
    employeeRole: signerInfo.role ?? "unknown",
    sessionId: payload.sessionId,
    agentRunId: payload.agentRunId,
    authorizationId: payload.authorizationId,
    signerAid: result.signer.aid,
    signerCredentialSaid: result.signer.credentialSaid,
    legalEntityLei: result.lei,
    action: payload.action,
  };
  writeAudit({
    traceId: input.traceId,
    component: "vlei-authorization",
    action: "authorization.verify",
    status: "succeeded",
    actor: verified.userId,
    tenantId: verified.tenantId,
    userId: verified.userId,
    sessionId: verified.sessionId,
    agentId: "luluguard-importer-agent",
    agentRunId: verified.agentRunId,
    data: { ...verified, resource: payload.resource, nonce: payload.nonce },
  });
  return verified;
}
