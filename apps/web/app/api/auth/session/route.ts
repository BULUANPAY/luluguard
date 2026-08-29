import { sessionFromRequest } from "../../../../lib/sandbox-auth";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const session = sessionFromRequest(request);
  return session
    ? Response.json({ session })
    : Response.json({ error: "尚未登入" }, { status: 401 });
}
