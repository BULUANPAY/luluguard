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

function sessionSecret() {
  return (
    process.env.SANDBOX_SESSION_SECRET ??
    "luluguard-sandbox-session-secret-change-me"
  );
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
    expiresAt: new Date(issuedAt.getTime() + 8 * 60 * 60 * 1000).toISOString(),
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
    const session = JSON.parse(
      Buffer.from(payload, "base64url").toString("utf8"),
    ) as SandboxSession;
    if (Date.parse(session.expiresAt) <= Date.now()) return undefined;
    const employee = employees.find(
      (candidate) => candidate.id === session.employee.id,
    );
    if (!employee) return undefined;
    return { ...session, employee: publicEmployee(employee) };
  } catch {
    return undefined;
  }
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
