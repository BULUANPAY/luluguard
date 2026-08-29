import assert from "node:assert/strict";
import { mkdtemp, readFile, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalizeJson,
  VleiJsonSigning,
  VleiJsonSigningError,
  type SignedJsonEnvelope,
} from "../src/index.js";

const ROOT_SEED_A = "correct horse battery staple";
const ROOT_SEED_B = "另一個任意長度的秘密字串 🔐";
const VALID_LEI = "8755001ELOZEL05BVX22";

async function service(seed = ROOT_SEED_A) {
  const stateDir = await mkdtemp(
    path.join(os.tmpdir(), "vlei-json-signing-test-"),
  );
  const envName = `VLEI_TEST_ROOT_SEED_${Math.random().toString(16).slice(2)}`;
  process.env[envName] = seed;
  return {
    client: new VleiJsonSigning({
      stateDir,
      rootSeedEnvName: envName,
    }),
    envName,
    stateDir,
  };
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

test("same seed produces the same root AID without persisting the seed", async () => {
  const first = await service();
  const second = await service();
  const firstRoot = await first.client.initialize();
  const secondRoot = await second.client.initialize();
  assert.equal(firstRoot.rootAid, secondRoot.rootAid);

  const stateText = await readFile(
    path.join(first.stateDir, "state.json"),
    "utf8",
  );
  assert.equal(stateText.includes(ROOT_SEED_A), false);
  assert.equal(
    (await stat(path.join(first.stateDir, "state.json"))).mode & 0o777,
    0o600,
  );
});

test("different seeds produce different root AIDs", async () => {
  const first = await service(ROOT_SEED_A);
  const second = await service(ROOT_SEED_B);
  assert.notEqual(
    (await first.client.initialize()).rootAid,
    (await second.client.initialize()).rootAid,
  );
});

test("accepts short, long, and Unicode root seed strings", async () => {
  const seeds = ["x", "密碼🔐", "long-secret-".repeat(100)];
  const roots = await Promise.all(
    seeds.map(
      async (seed) => (await (await service(seed)).client.initialize()).rootAid,
    ),
  );
  assert.equal(new Set(roots).size, seeds.length);
});

test("creates an idempotent signer and rejects conflicting signer info", async () => {
  const { client } = await service();
  const input = { id: "alice", info: { name: "Alice", role: "Approver" } };
  const first = await client.createSigner(input);
  const second = await client.createSigner(input);
  assert.deepEqual(second, first);

  await assert.rejects(
    client.createSigner({ id: "alice", info: { name: "Mallory" } }),
    (error: unknown) =>
      error instanceof VleiJsonSigningError &&
      error.code === "SIGNER_ID_CONFLICT",
  );
});

test("signs and verifies arbitrary JSON and returns root-authorized signer info", async () => {
  const { client } = await service();
  const rootAid = (await client.initialize()).rootAid;
  const signer = await client.createSigner({
    id: "alice",
    info: { name: "王小明", limits: [100, 5000], active: true },
  });
  const payload = {
    nested: { z: null, a: "測試" },
    rows: [1, false, { amount: 42.5 }],
  };
  const envelope = await client.signJson({
    signerId: "alice",
    lei: VALID_LEI,
    payload,
  });
  const transferred = JSON.parse(JSON.stringify(envelope)) as typeof envelope;
  const result = await client.verifyJson(transferred, {
    expectedRootAid: rootAid,
  });
  assert.equal(result.valid, true);
  if (result.valid) {
    assert.deepEqual(result.payload, payload);
    assert.equal(result.signer.aid, signer.aid);
    assert.equal(result.lei, VALID_LEI);
    assert.deepEqual(result.signer.info, signer.info);
  }
});

test("object key order does not affect verification", async () => {
  const { client } = await service();
  const rootAid = (await client.initialize()).rootAid;
  await client.createSigner({ id: "alice", info: {} });
  const envelope = await client.signJson({
    signerId: "alice",
    lei: VALID_LEI,
    payload: { a: 1, b: { c: 2, d: 3 } },
  });
  envelope.payload = { b: { d: 3, c: 2 }, a: 1 };
  assert.equal(
    (await client.verifyJson(envelope, { expectedRootAid: rootAid })).valid,
    true,
  );
});

test("rejects payload, signer metadata, signature, proof, and root tampering", async () => {
  const first = await service(ROOT_SEED_A);
  const second = await service(ROOT_SEED_B);
  const firstRoot = (await first.client.initialize()).rootAid;
  const secondRoot = (await second.client.initialize()).rootAid;
  await first.client.createSigner({ id: "alice", info: { role: "Approver" } });
  const original = await first.client.signJson({
    signerId: "alice",
    lei: VALID_LEI,
    payload: { amount: 10 },
  });

  const payloadTampered = clone(original);
  payloadTampered.payload.amount = 11;
  assert.equal(
    (
      await first.client.verifyJson(payloadTampered, {
        expectedRootAid: firstRoot,
      })
    ).valid,
    false,
  );

  const infoTampered = clone(original);
  infoTampered.signer.credential.a = {
    ...(infoTampered.signer.credential.a as object),
    info: { role: "Admin" },
  } as never;
  assert.equal(
    (
      await first.client.verifyJson(infoTampered, {
        expectedRootAid: firstRoot,
      })
    ).valid,
    false,
  );

  const signatureTampered = clone(original);
  signatureTampered.signature = `${signatureTampered.signature.slice(0, -1)}A`;
  assert.equal(
    (
      await first.client.verifyJson(signatureTampered, {
        expectedRootAid: firstRoot,
      })
    ).valid,
    false,
  );

  const leiTampered = clone(original);
  leiTampered.protected.lei = "529900T8BM49AURSDO55";
  assert.equal(
    (
      await first.client.verifyJson(leiTampered, {
        expectedRootAid: firstRoot,
      })
    ).valid,
    false,
  );

  const proofTampered = clone(original);
  proofTampered.proof.credentialTel = [];
  assert.equal(
    (
      await first.client.verifyJson(proofTampered, {
        expectedRootAid: firstRoot,
      })
    ).valid,
    false,
  );

  assert.equal(
    (await first.client.verifyJson(original, { expectedRootAid: secondRoot }))
      .valid,
    false,
  );
  assert.equal(
    (
      await first.client.verifyJson(original, {
        expectedRootAid: firstRoot,
        expectedLei: "00000000000000000000",
      })
    ).valid,
    false,
  );
});

test("rejects invalid JSON values and unknown signers", async () => {
  assert.throws(() => canonicalizeJson(Number.NaN as never), /finite/);
  const cyclic: Record<string, unknown> = {};
  cyclic.self = cyclic;
  assert.throws(() => canonicalizeJson(cyclic as never), /cycles/);

  const { client } = await service();
  await client.initialize();
  await assert.rejects(
    client.signJson({ signerId: "missing", lei: VALID_LEI, payload: null }),
    (error: unknown) =>
      error instanceof VleiJsonSigningError &&
      error.code === "SIGNER_NOT_FOUND",
  );
});

test("requires a valid root seed and detects existing-state seed mismatch", async () => {
  const missing = await service();
  delete process.env[missing.envName];
  await assert.rejects(
    missing.client.initialize(),
    (error: unknown) =>
      error instanceof VleiJsonSigningError &&
      error.code === "ROOT_SEED_MISSING",
  );

  const empty = await service("");
  await assert.rejects(
    empty.client.initialize(),
    (error: unknown) =>
      error instanceof VleiJsonSigningError &&
      error.code === "ROOT_SEED_INVALID",
  );

  const existing = await service(ROOT_SEED_A);
  await existing.client.initialize();
  process.env[existing.envName] = ROOT_SEED_B;
  await assert.rejects(
    existing.client.getRootAid(),
    (error: unknown) =>
      error instanceof VleiJsonSigningError &&
      error.code === "ROOT_AID_MISMATCH",
  );
});

test("requires a checksum-valid LEI when signing", async () => {
  const setup = await service();
  await setup.client.initialize();
  await setup.client.createSigner({ id: "alice", info: {} });
  await assert.rejects(
    setup.client.signJson({ signerId: "alice", lei: "", payload: null }),
    (error: unknown) =>
      error instanceof VleiJsonSigningError && error.code === "LEI_MISSING",
  );

  await assert.rejects(
    setup.client.signJson({
      signerId: "alice",
      lei: "12345678901234567890",
      payload: null,
    }),
    (error: unknown) =>
      error instanceof VleiJsonSigningError && error.code === "LEI_INVALID",
  );
});

test("verification can use an explicit public root AID without a root seed", async () => {
  const setup = await service();
  const rootAid = (await setup.client.initialize()).rootAid;
  await setup.client.createSigner({ id: "alice", info: {} });
  const envelope: SignedJsonEnvelope = await setup.client.signJson({
    signerId: "alice",
    lei: VALID_LEI,
    payload: "hello",
  });
  delete process.env[setup.envName];
  assert.equal(
    (await setup.client.verifyJson(envelope, { expectedRootAid: rootAid }))
      .valid,
    true,
  );
});

test("returns a structured failure for a malformed envelope", async () => {
  const setup = await service();
  const rootAid = (await setup.client.initialize()).rootAid;
  const result = await setup.client.verifyJson(null as never, {
    expectedRootAid: rootAid,
  });
  assert.deepEqual(result, {
    valid: false,
    errors: [
      { code: "ENVELOPE_INVALID", message: "Envelope must be an object" },
    ],
  });
});

test("detects corrupted persisted root state", async () => {
  const setup = await service();
  await setup.client.initialize();
  const file = path.join(setup.stateDir, "state.json");
  const state = JSON.parse(await readFile(file, "utf8")) as {
    root: { verkey: string };
  };
  state.root.verkey = `D${"A".repeat(43)}`;
  await writeFile(file, JSON.stringify(state), { mode: 0o600 });
  await assert.rejects(
    setup.client.getRootAid(),
    (error: unknown) =>
      error instanceof VleiJsonSigningError && error.code === "STATE_INVALID",
  );
});

test("serializes concurrent signer creation without losing state", async () => {
  const setup = await service();
  const signers = await Promise.all(
    Array.from({ length: 4 }, (_, index) =>
      setup.client.createSigner({ id: `signer-${index}`, info: { index } }),
    ),
  );
  assert.equal(new Set(signers.map((signer) => signer.aid)).size, 4);
  for (const signer of signers) {
    const envelope = await setup.client.signJson({
      signerId: signer.id,
      lei: VALID_LEI,
      payload: { signer: signer.id },
    });
    assert.equal(
      (
        await setup.client.verifyJson(envelope, {
          expectedRootAid: await setup.client.getRootAid(),
        })
      ).valid,
      true,
    );
  }
});
