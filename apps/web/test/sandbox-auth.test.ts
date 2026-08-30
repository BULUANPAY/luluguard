import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import {
  authenticateEmployee,
  createSandboxSession,
  type SandboxSession,
  verifySandboxSession,
} from "../lib/sandbox-auth";

const testSecret = "test-session-secret-with-at-least-32-characters";

function alice() {
  const employee = authenticateEmployee("alice", "alice-demo");
  assert.ok(employee);
  return employee;
}

function signSession(session: SandboxSession) {
  const payload = Buffer.from(JSON.stringify(session)).toString("base64url");
  const signature = createHmac("sha256", testSecret)
    .update(payload)
    .digest("base64url");
  return `${payload}.${signature}`;
}

test("accepts a valid signed sandbox session", () => {
  const previousSecret = process.env.SANDBOX_SESSION_SECRET;
  process.env.SANDBOX_SESSION_SECRET = testSecret;
  try {
    const { session, token } = createSandboxSession(alice());
    assert.deepEqual(verifySandboxSession(token), session);
  } finally {
    if (previousSecret === undefined) delete process.env.SANDBOX_SESSION_SECRET;
    else process.env.SANDBOX_SESSION_SECRET = previousSecret;
  }
});

test("rejects signed sessions with invalid or excessive lifetimes", () => {
  const previousSecret = process.env.SANDBOX_SESSION_SECRET;
  process.env.SANDBOX_SESSION_SECRET = testSecret;
  try {
    const { session } = createSandboxSession(alice());
    assert.equal(
      verifySandboxSession(signSession({ ...session, expiresAt: "invalid" })),
      undefined,
    );
    assert.equal(
      verifySandboxSession(
        signSession({
          ...session,
          expiresAt: new Date(
            Date.parse(session.issuedAt) + 9 * 60 * 60 * 1000,
          ).toISOString(),
        }),
      ),
      undefined,
    );
  } finally {
    if (previousSecret === undefined) delete process.env.SANDBOX_SESSION_SECRET;
    else process.env.SANDBOX_SESSION_SECRET = previousSecret;
  }
});

test("requires a strong session secret in production", () => {
  const environment = process.env as Record<string, string | undefined>;
  const previousEnvironment = process.env.NODE_ENV;
  const previousSecret = process.env.SANDBOX_SESSION_SECRET;
  environment.NODE_ENV = "production";
  delete process.env.SANDBOX_SESSION_SECRET;
  try {
    assert.throws(
      () => createSandboxSession(alice()),
      /SANDBOX_SESSION_SECRET must contain at least 32 characters/,
    );
  } finally {
    if (previousEnvironment === undefined) delete environment.NODE_ENV;
    else environment.NODE_ENV = previousEnvironment;
    if (previousSecret === undefined) delete process.env.SANDBOX_SESSION_SECRET;
    else process.env.SANDBOX_SESSION_SECRET = previousSecret;
  }
});
