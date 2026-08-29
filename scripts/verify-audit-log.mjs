import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";

const requestedPaths = process.argv.slice(2);
const paths =
  requestedPaths.length > 0
    ? requestedPaths
    : ["apps/web/logs/audit.jsonl", "apps/importer-mcp/logs/audit.jsonl"];

let checked = 0;
let invalid = false;

for (const inputPath of paths) {
  const path = resolve(inputPath);
  if (!existsSync(path)) {
    console.log(`SKIP ${inputPath}: file not found`);
    continue;
  }
  const lines = readFileSync(path, "utf8").split("\n").filter(Boolean);
  let previousHash = "GENESIS";
  for (const [index, line] of lines.entries()) {
    let entry;
    try {
      entry = JSON.parse(line);
    } catch {
      console.error(`FAIL ${inputPath}:${index + 1}: invalid JSON`);
      invalid = true;
      break;
    }
    const { hash, ...unsigned } = entry;
    const expected = createHash("sha256")
      .update(JSON.stringify(unsigned))
      .digest("hex");
    if (entry.previousHash !== previousHash || hash !== expected) {
      console.error(`FAIL ${inputPath}:${index + 1}: hash chain mismatch`);
      invalid = true;
      break;
    }
    previousHash = hash;
  }
  if (!invalid) console.log(`OK ${inputPath}: ${lines.length} entries`);
  checked += 1;
}

if (checked === 0) {
  console.error("No audit log files were found.");
  process.exitCode = 1;
} else if (invalid) {
  process.exitCode = 1;
}
