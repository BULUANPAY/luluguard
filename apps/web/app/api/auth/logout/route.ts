import {
  sandboxSessionCookie,
  sessionFromRequest,
} from "../../../../lib/sandbox-auth";
import {
  clearAuditTraceContext,
  newAuditId,
  writeAudit,
} from "../../../../lib/audit";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = sessionFromRequest(request);
  if (session) {
    const traceId = newAuditId("TRACE");
    writeAudit({
      traceId,
      component: "sandbox-auth",
      action: "employee.logout",
      status: "succeeded",
      actor: session.employee.id,
      tenantId: session.employee.tenantId,
      userId: session.employee.id,
      sessionId: session.sessionId,
    });
    clearAuditTraceContext(traceId);
  }
  return Response.json(
    { ok: true },
    {
      headers: {
        "Set-Cookie": `${sandboxSessionCookie}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`,
      },
    },
  );
}
