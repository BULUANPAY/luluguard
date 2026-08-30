import {
  authenticateEmployee,
  createSandboxSession,
  sandboxSessionCookie,
} from "../../../../lib/sandbox-auth";
import {
  clearAuditTraceContext,
  newAuditId,
  writeAudit,
} from "../../../../lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const traceId = newAuditId("TRACE");
  const body = (await request.json()) as {
    username?: string;
    password?: string;
  };
  const employee = authenticateEmployee(
    body.username ?? "",
    body.password ?? "",
  );
  if (!employee) {
    writeAudit({
      traceId,
      component: "sandbox-auth",
      action: "employee.login",
      status: "blocked",
      actor: body.username ?? "unknown",
      data: { username: body.username, reason: "INVALID_CREDENTIALS" },
    });
    clearAuditTraceContext(traceId);
    return Response.json({ error: "帳號或密碼錯誤" }, { status: 401 });
  }

  const { session, token } = createSandboxSession(employee);
  writeAudit({
    traceId,
    component: "sandbox-auth",
    action: "employee.login",
    status: "succeeded",
    actor: employee.id,
    tenantId: employee.tenantId,
    userId: employee.id,
    sessionId: session.sessionId,
    data: { employee },
  });
  clearAuditTraceContext(traceId);
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return Response.json(
    { session },
    {
      headers: {
        "Set-Cookie": `${sandboxSessionCookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800${secure}`,
      },
    },
  );
}
