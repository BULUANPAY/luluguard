import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

export type AuthorizedWorkflowAction = "precheck" | "broker_quote" | "payment";

export interface SandboxEmployee {
  id: string;
  username: string;
  name: string;
  tenantId: string;
  legalEntityName: string;
  lei: string;
  role: string;
  allowedActions: AuthorizedWorkflowAction[];
}

export interface SandboxSession {
  employee: SandboxEmployee;
  sessionId: string;
  issuedAt: string;
  expiresAt: string;
}

interface EmployeeRecord extends SandboxEmployee {
  password: string;
}

const employees: EmployeeRecord[] = [
  {
    id: "EMP-ALICE",
    username: "alice",
    password: "alice-demo",
    name: "Alice Chen",
    tenantId: "TENANT-LULU-IMPORTS",
    legalEntityName: "LuLu Imports Sandbox Ltd.",
    lei: "8755001ELOZEL05BVX22",
    role: "Import Operations Manager",
    allowedActions: ["precheck", "broker_quote", "payment"],
  },
  {
    id: "EMP-BOB",
    username: "bob",
    password: "bob-demo",
    name: "Bob Lin",
    tenantId: "TENANT-LULU-IMPORTS",
    legalEntityName: "LuLu Imports Sandbox Ltd.",
    lei: "8755001ELOZEL05BVX22",
    role: "Import Operations Specialist",
    allowedActions: ["precheck", "broker_quote"],
  },
];

export const sandboxSessionCookie = "luluguard_sandbox_session";
const sandboxSessionDurationMs = 8 * 60 * 60 * 1000;
const allowedClockSkewMs = 30_000;
const developmentSessionSecret =
  "luluguard-sandbox-session-secret-change-me";

function sessionSecret() {
  const configured = process.env.SANDBOX_SESSION_SECRET?.trim();
  if (process.env.NODE_ENV === "production" && (!configured || configured.length < 32)) {
    throw new Error(
      "SANDBOX_SESSION_SECRET must contain at least 32 characters in production",
    );
  }
  return configured || developmentSessionSecret;
}

function sign(encodedPayload: string) {
  return createHmac("sha256", sessionSecret())
    .update(encodedPayload)
    .digest("base64url");
}

function publicEmployee(record: EmployeeRecord): SandboxEmployee {
  return {
    id: record.id,
    username: record.username,
    name: record.name,
    tenantId: record.tenantId,
    legalEntityName: record.legalEntityName,
    lei: record.lei,
    role: record.role,
    allowedActions: record.allowedActions,
  };
}

export function authenticateEmployee(
  username: string,
  password: string,
): SandboxEmployee | undefined {
  const record = employees.find((candidate) => candidate.username === username);
  if (!record) return undefined;
  const supplied = Buffer.from(password);
  const expected = Buffer.from(record.password);
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return undefined;
  return publicEmployee(record);
}

export function createSandboxSession(employee: SandboxEmployee): {
  session: SandboxSession;
  token: string;
} {
  const issuedAt = new Date();
  const session: SandboxSession = {
    employee,
    sessionId: `SESSION-${randomUUID()}`,
    issuedAt: issuedAt.toISOString(),
    expiresAt: new Date(issuedAt.getTime() + sandboxSessionDurationMs).toISOString(),
  };
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  return { session, token: `${payload}.${sign(payload)}` };
}

export function verifySandboxSession(
  token: string | undefined,
): SandboxSession | undefined {
  if (!token) return undefined;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return undefined;
  const supplied = Buffer.from(signature);
  const expected = Buffer.from(sign(payload));
  if (
    supplied.length !== expected.length ||
    !timingSafeEqual(supplied, expected)
  )
    return undefined;
  try {
    const value: unknown = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    );
    if (!isRecord(value) || !isRecord(value.employee)) return undefined;
    const { issuedAt, expiresAt, sessionId } = value;
    const employeeId = value.employee.id;
    if (
      typeof issuedAt !== "string" ||
      typeof expiresAt !== "string" ||
      typeof sessionId !== "string" ||
      !sessionId.trim() ||
      typeof employeeId !== "string"
    ) {
      return undefined;
    }
    const issuedAtMs = Date.parse(issuedAt);
    const expiresAtMs = Date.parse(expiresAt);
    const now = Date.now();
    if (
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      issuedAtMs > now + allowedClockSkewMs ||
      expiresAtMs <= now ||
      expiresAtMs <= issuedAtMs ||
      expiresAtMs - issuedAtMs > sandboxSessionDurationMs
    ) {
      return undefined;
    }
    const employee = employees.find(
      (candidate) => candidate.id === employeeId,
    );
    if (!employee) return undefined;
    return {
      sessionId,
      issuedAt,
      expiresAt,
      employee: publicEmployee(employee),
    };
  } catch {
    return undefined;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function sessionFromRequest(
  request: Request,
): SandboxSession | undefined {
  const cookie = request.headers.get("cookie") ?? "";
  const token = cookie
    .split(";")
    .map((part) => part.trim().split("="))
    .find(([name]) => name === sandboxSessionCookie)?.[1];
  return verifySandboxSession(token);
}
