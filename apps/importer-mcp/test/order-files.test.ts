import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { getOrderFiles } from "../src/order-files.js";

test("returns parsed JSON files grouped by document type", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "luluguard-order-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const invoiceDirectory = path.join(root, "ORD-1001", "commercial_invoice");
  const customDirectory = path.join(root, "ORD-1001", "insurance_policy");
  await mkdir(invoiceDirectory, { recursive: true });
  await mkdir(customDirectory, { recursive: true });
  await writeFile(path.join(invoiceDirectory, "invoice-1.json"), JSON.stringify({ invoiceNumber: "INV-1" }));
  await writeFile(path.join(customDirectory, "policy-1.json"), JSON.stringify({ policyNumber: "POL-1" }));
  await writeFile(path.join(invoiceDirectory, "notes.txt"), "ignored");

  const files = await getOrderFiles(root, "ORD-1001");

  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => file.documentType), ["commercial_invoice", "insurance_policy"]);
  assert.deepEqual(files[0]?.content, { invoiceNumber: "INV-1" });
  assert.equal(files[0]?.path, "uploaded-files/ORD-1001/commercial_invoice/invoice-1.json");
});

test("filters document types and returns an empty list for an unknown order", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "luluguard-order-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const directory = path.join(root, "ORD-1001", "packing_list");
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, "packing.json"), "{}");

  assert.equal((await getOrderFiles(root, "ORD-1001", ["commercial_invoice"])).length, 0);
  assert.deepEqual(await getOrderFiles(root, "ORD-UNKNOWN"), []);
});

test("rejects unsafe path segments and does not follow symlinks", async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), "luluguard-order-files-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  await assert.rejects(() => getOrderFiles(root, "../secret"), /orderId/);
  await assert.rejects(() => getOrderFiles(root, "ORD-1001", ["../secret"]), /documentType/);

  const orderDirectory = path.join(root, "ORD-1001");
  const outsideDirectory = path.join(root, "outside");
  await mkdir(orderDirectory, { recursive: true });
  await mkdir(outsideDirectory, { recursive: true });
  await writeFile(path.join(outsideDirectory, "secret.json"), JSON.stringify({ secret: true }));
  await symlink(outsideDirectory, path.join(orderDirectory, "linked_type"));

  assert.deepEqual(await getOrderFiles(root, "ORD-1001"), []);
});
