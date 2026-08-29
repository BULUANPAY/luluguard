import assert from "node:assert/strict";
import { VleiJsonSigning } from "@repo/vlei-json-signing";

if (!process.env.VLEI_ROOT_SEED) {
  process.env.VLEI_ROOT_SEED = "local-smoke-test-only-seed";
  console.warn(
    "VLEI_ROOT_SEED is not set; using a local smoke-test-only seed.",
  );
}

const signing = new VleiJsonSigning();

const { rootAid } = await signing.initialize();
const derivedRootAid = await VleiJsonSigning.deriveRootAid(
  process.env.VLEI_ROOT_SEED,
);
assert.equal(derivedRootAid, rootAid);
const lei = "8755001ELOZEL05BVX22";

const signer = await signing.createSigner({
  id: "test-signer",
  info: {
    name: "LuLuGuard Test Signer",
    role: "Integration Test",
    environment: "local",
  },
});

const originalJson = {
  message: "Hello, world!",
};

const envelope = await signing.signJson({
  signerId: signer.id,
  lei,
  payload: originalJson,
});

console.log("Root AID:", rootAid);
console.log("Legal Entity Identifier:", lei);
console.log("State directory:", signing.stateDir);
console.log("Signer:", signer);
console.log("Signed envelope:");
console.log(JSON.stringify(envelope, null, 2));

const verification = await VleiJsonSigning.verifyJson(envelope, {
  expectedRootAid: rootAid,
  expectedLei: lei,
});

if (!verification.valid) {
  console.error("Verification failed:", verification.errors);
  process.exitCode = 1;
} else {
  assert.deepEqual(verification.payload, originalJson);
  assert.deepEqual(verification.signer.info, signer.info);
  assert.equal(verification.signer.aid, signer.aid);
  assert.equal(verification.rootAid, rootAid);
  assert.equal(verification.lei, lei);

  console.log("Verification: PASS");
  console.log("Verified signer info:", verification.signer.info);
}
