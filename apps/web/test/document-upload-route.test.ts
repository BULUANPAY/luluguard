import assert from "node:assert/strict";
import { test } from "node:test";
import { POST } from "../app/api/documents/upload/route";
import {
  authenticateEmployee,
  createSandboxSession,
  sandboxSessionCookie,
} from "../lib/sandbox-auth";

function uploadRequest(formData: FormData, token?: string) {
  return new Request("http://localhost/api/documents/upload", {
    method: "POST",
    headers: token ? { cookie: `${sandboxSessionCookie}=${token}` } : undefined,
    body: formData,
  });
}

test("rejects anonymous document uploads", async () => {
  const formData = new FormData();
  formData.set("orderId", "ORDER-1");

  const response = await POST(uploadRequest(formData));

  assert.equal(response.status, 401);
  assert.deepEqual(await response.json(), { error: "請先登入員工帳號。" });
});

test("continues input validation for an authenticated upload", async () => {
  const employee = authenticateEmployee("alice", "alice-demo");
  assert.ok(employee);
  const { token } = createSandboxSession(employee);
  const formData = new FormData();
  formData.set("orderId", "../unsafe");

  const response = await POST(uploadRequest(formData, token));

  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "訂單編號格式不正確。" });
});
