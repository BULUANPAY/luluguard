const mcpPolicyUrl = new URL(
  "/admin/policy",
  process.env.MCP_SERVER_URL ?? "http://127.0.0.1:4020/mcp"
).toString();

async function forward(request: Request, method: "GET" | "PUT", body?: unknown) {
  const policyAdminApiKey = request.headers.get("x-policy-admin-key") ?? "";
  if (!policyAdminApiKey) return Response.json({ error: "Policy admin key is required" }, { status: 401 });
  const response = await fetch(mcpPolicyUrl, {
    method,
    cache: "no-store",
    headers: {
      Authorization: `Bearer ${policyAdminApiKey}`,
      "Content-Type": "application/json",
      "X-Policy-Actor": "nextjs-admin"
    },
    body: body === undefined ? undefined : JSON.stringify(body)
  });
  const data = await response.json().catch(() => ({ error: "Invalid MCP response" }));
  return Response.json(data, { status: response.status });
}

export async function GET(request: Request) {
  return forward(request, "GET");
}

export async function PUT(request: Request) {
  return forward(request, "PUT", await request.json());
}
