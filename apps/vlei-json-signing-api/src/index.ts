import { fileURLToPath } from "node:url";
import path from "node:path";

import { VleiJsonSigning } from "@repo/vlei-json-signing";

import { createApp } from "./server.js";

// apps/vlei-json-signing-api/src -> repo root, so relative VLEI_STATE_DIR
// values behave the same regardless of the process's current working directory.
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

const port = Number(process.env.VLEI_SIGNING_API_PORT ?? 3000);

const signing = new VleiJsonSigning({
  stateDir: process.env.VLEI_STATE_DIR
    ? path.resolve(repoRoot, process.env.VLEI_STATE_DIR)
    : undefined,
});

createApp(signing).listen(port, () => {
  console.log(`vlei-json-signing-api listening on port ${port}`);
});
