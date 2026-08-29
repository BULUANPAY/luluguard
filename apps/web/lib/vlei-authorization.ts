import {
  canonicalizeJson,
  VleiJsonSigning,
  type JsonObject,
  type SignedJsonEnvelope,
} from "@repo/vlei-json-signing";
import { createHash } from "node:crypto";
import { newAuditId, writeAudit } from "./audit";
import type { AuthorizedWorkflowAction, SandboxSession } from "./sandbox-auth";

export interface AgentAuthorizationPayload extends JsonObject {
  type: "LuLuGuardSandboxAgentAuthorization";
  authorizationId: string;
  nonce: string;
  issuedAt: string;
  expiresAt: string;
  tenantId: string;
  legalEntityName: string;
  legalEntityLei: string;
  employeeId: string;
  sessionId: string;
  agentId: "luluguard-importer-agent";
  agentVersion: "0.4.0";
  agentRunId: string;
  traceId: string;
  action: AuthorizedWorkflowAction;
  resource: Record<string, string | string[] | boolean>;
}

export type SignedAgentAuthorization =
  SignedJsonEnvelope<AgentAuthorizationPayload>;

const signing = new VleiJsonSigning();

function deriveSignerId(info: Record<string, string | string[]>): string {
  const digest = createHash("sha256")
    .update(canonicalizeJson(info))
    .digest("hex");
  return `signer-${digest.slice(0, 32)}`;
}

export async function createAgentAuthorization(input: {
  session: SandboxSession;
  action: AuthorizedWorkflowAction;
  traceId: string;
  agentRunId: string;
  resource: Record<string, string | string[] | boolean | undefined>;
}): Promise<SignedAgentAuthorization> {
  const { employee } = input.session;
  const auditContext = {
    traceId: input.traceId,
    actor: employee.id,
    tenantId: employee.tenantId,
    userId: employee.id,
    sessionId: input.session.sessionId,
    agentId: "luluguard-importer-agent",
    agentRunId: input.agentRunId,
  } as const;
  if (!employee.allowedActions.includes(input.action)) {
    writeAudit({
      ...auditContext,
      component: "vlei-authorization",
      action: "authorization.issue",
      status: "blocked",
      data: {
        requestedAction: input.action,
        role: employee.role,
        allowedActions: employee.allowedActions,
      },
    });
    throw new Error(`員工角色 ${employee.role} 未被授權執行 ${input.action}`);
  }

  const issuedAt = new Date();
  const resource = Object.fromEntries(
    Object.entries(input.resource).filter((entry) => entry[1] !== undefined),
  ) as AgentAuthorizationPayload["resource"];
  const payload: AgentAuthorizationPayload = {
    type: "LuLuGuardSandboxAgentAuthorization",
    authorizationId: newAuditId("VLEI-AUTH"),
    nonce: newAuditId("NONCE"),
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + 10 * 60 * 1000).toISOString(),
    tenantId: employee.tenantId,
    legalEntityName: employee.legalEntityName,
    legalEntityLei: employee.lei,
    employeeId: employee.id,
    sessionId: input.session.sessionId,
    agentId: "luluguard-importer-agent",
    agentVersion: "0.4.0",
    agentRunId: input.agentRunId,
    traceId: input.traceId,
    action: input.action,
    resource,
  };
  writeAudit({
    ...auditContext,
    component: "vlei-authorization",
    action: "authorization.issue",
    status: "attempted",
    data: { payload },
  });
  const signerInfo = {
    employeeId: employee.id,
    name: employee.name,
    tenantId: employee.tenantId,
    legalEntityName: employee.legalEntityName,
    lei: employee.lei,
    role: employee.role,
    allowedActions: employee.allowedActions,
  };
  let envelope: SignedAgentAuthorization;
  try {
    const signerId = deriveSignerId(signerInfo);
    await signing.createSigner({ id: signerId, info: signerInfo });
    envelope = await signing.signJson({
      signerId,
      lei: employee.lei,
      payload,
    });
  } catch (error) {
    writeAudit({
      ...auditContext,
      component: "vlei-authorization",
      action: "authorization.issue",
      status: "failed",
      data: { payload, error },
    });
    throw new Error(
      `vLEI package 授權簽署失敗：${error instanceof Error ? error.message : "未知錯誤"}`,
      { cause: error },
    );
  }
  writeAudit({
    ...auditContext,
    component: "vlei-authorization",
    action: "authorization.issue",
    status: "succeeded",
    data: {
      authorizationId: payload.authorizationId,
      signerAid: envelope.protected.signerAid,
      signerCredentialSaid: envelope.protected.signerCredentialSaid,
      payload,
    },
  });
  return envelope;
}
