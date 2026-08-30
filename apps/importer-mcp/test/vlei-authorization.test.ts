import assert from "node:assert/strict";
import { test } from "node:test";
import { AuthorizationReplayGuard } from "../src/vlei-authorization.js";

test("rejects nonce replay while an authorization remains valid", () => {
  const guard = new AuthorizationReplayGuard();

  assert.equal(guard.consume("NONCE-1", 200, 100), true);
  assert.equal(guard.consume("NONCE-1", 200, 101), false);
  assert.equal(guard.activeCount, 1);
});

test("expires consumed nonce records", () => {
  const guard = new AuthorizationReplayGuard();

  assert.equal(guard.consume("NONCE-1", 200, 100), true);
  assert.equal(guard.consume("NONCE-2", 300, 201), true);
  assert.equal(guard.activeCount, 1);
  assert.equal(guard.consume("NONCE-1", 400, 201), true);
  assert.equal(guard.activeCount, 2);
});
