import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { canonicalizeJson } from "./canonicalize.js";
import type {
  AuthorizedSigner,
  JsonObject,
  JsonValue,
  SignerInfo,
  SignedJsonEnvelope,
  VerificationResult,
  VleiJsonSigningOptions,
  VleiStaticOptions,
  VleiVerifyOptions,
} from "./types.js";

export type * from "./types.js";
export { canonicalizeJson } from "./canonicalize.js";

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
}

interface BridgePaths {
  bridgePath: string;
  sandboxScriptsPath: string;
  defaultStateDir: string;
}

function locateBridge(): BridgePaths {
  let packageRoot = path.dirname(fileURLToPath(import.meta.url));
  while (!existsSync(path.join(packageRoot, "python", "bridge.py"))) {
    const parent = path.dirname(packageRoot);
    if (parent === packageRoot) {
      throw new VleiJsonSigningError(
        "PACKAGE_LAYOUT_INVALID",
        "Unable to locate the bundled Python bridge",
      );
    }
    packageRoot = parent;
  }
  return {
    bridgePath: path.join(packageRoot, "python", "bridge.py"),
    sandboxScriptsPath: path.resolve(
      packageRoot,
      "..",
      "..",
      "vendor",
      "vlei-sandbox",
      "scripts",
    ),
    defaultStateDir: path.join(packageRoot, ".vlei-json-signing"),
  };
}

async function runBridge<T>(
  command: string,
  input: JsonObject | object,
  options: {
    pythonExecutable?: string;
    stateDir?: string;
    rootSeedEnvName?: string;
  } = {},
): Promise<T> {
  const paths = locateBridge();
  const request = JSON.stringify({
    command,
    input,
    rootSeedEnvName: options.rootSeedEnvName,
  });
  const stdout: Buffer[] = [];
  const stderr: Buffer[] = [];
  const arguments_ = [
    paths.bridgePath,
    "--sandbox-scripts",
    paths.sandboxScriptsPath,
  ];
  if (options.stateDir) {
    arguments_.push("--state-dir", options.stateDir);
  }

  const child = spawn(
    /* turbopackIgnore: true */ options.pythonExecutable ?? "python3",
    arguments_,
    {
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"],
    },
  );
  child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
  child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
  child.stdin.end(request);

  const exitCode = await new Promise<number | null>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", resolve);
  }).catch((error: unknown) => {
    throw new VleiJsonSigningError(
      "BRIDGE_START_FAILED",
      error instanceof Error ? error.message : "Failed to start Python bridge",
    );
  });

  const output = Buffer.concat(stdout).toString("utf8");
  let response: BridgeResponse<T>;
  try {
    response = JSON.parse(output) as BridgeResponse<T>;
  } catch {
    const detail = Buffer.concat(stderr).toString("utf8").trim();
    throw new VleiJsonSigningError(
      "BRIDGE_PROTOCOL_ERROR",
      detail || `Python bridge exited with code ${String(exitCode)}`,
    );
  }
  if (!response.ok || response.result === undefined) {
    throw new VleiJsonSigningError(
      response.error?.code ?? "BRIDGE_ERROR",
      response.error?.message ?? "Python bridge operation failed",
    );
  }
  return response.result;
}

function invalidEnvelope<T extends JsonValue>(): VerificationResult<T> {
  return {
    valid: false,
    errors: [
      { code: "ENVELOPE_INVALID", message: "Envelope must be an object" },
    ],
  };
}

async function verifyEnvelope<T extends JsonValue>(
  envelope: SignedJsonEnvelope<T>,
  options: { expectedRootAid: string; expectedLei?: string },
  runtime: { pythonExecutable?: string; stateDir?: string },
): Promise<VerificationResult<T>> {
  if (envelope === null || typeof envelope !== "object") {
    return invalidEnvelope();
  }
  let canonicalPayload: string;
  try {
    canonicalPayload = canonicalizeJson(envelope.payload);
  } catch (error) {
    return {
      valid: false,
      errors: [
        {
          code: "INVALID_PAYLOAD",
          message:
            error instanceof Error ? error.message : "Invalid JSON payload",
        },
      ],
    };
  }
  return runBridge(
    "verify",
    {
      envelope,
      canonicalPayload,
      expectedRootAid: options.expectedRootAid,
      expectedLei: options.expectedLei,
    },
    runtime,
  );
}

export class VleiJsonSigningError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "VleiJsonSigningError";
    this.code = code;
  }
}

export class VleiJsonSigning {
  readonly stateDir: string;
  readonly pythonExecutable: string;
  readonly rootSeedEnvName: string;

  constructor(options: VleiJsonSigningOptions = {}) {
    this.stateDir = options.stateDir
      ? path.resolve(options.stateDir)
      : locateBridge().defaultStateDir;
    this.pythonExecutable = options.pythonExecutable ?? "python3";
    this.rootSeedEnvName = options.rootSeedEnvName ?? "VLEI_ROOT_SEED";
  }

  static async deriveRootAid(
    seed: string,
    options: VleiStaticOptions = {},
  ): Promise<string> {
    const result = await runBridge<{ rootAid: string }>(
      "derive-root-aid",
      { seed },
      options,
    );
    return result.rootAid;
  }

  static async verifyJson<T extends JsonValue>(
    envelope: SignedJsonEnvelope<T>,
    options: VleiVerifyOptions,
  ): Promise<VerificationResult<T>> {
    if (!options?.expectedRootAid?.trim()) {
      throw new VleiJsonSigningError(
        "EXPECTED_ROOT_REQUIRED",
        "An expected root AID is required",
      );
    }
    return verifyEnvelope(envelope, options, {
      pythonExecutable: options.pythonExecutable,
    });
  }

  async initialize(): Promise<{ rootAid: string }> {
    return this.#runBridge("initialize", {});
  }

  async getRootAid(): Promise<string> {
    const result = await this.#runBridge<{ rootAid: string }>("root-aid", {});
    return result.rootAid;
  }

  async createSigner(input: SignerInfo): Promise<AuthorizedSigner> {
    if (!input.id.trim()) {
      throw new VleiJsonSigningError(
        "INVALID_SIGNER_ID",
        "Signer id must not be empty",
      );
    }
    canonicalizeJson(input.info);
    return this.#runBridge("create-signer", input);
  }

  async signJson<T extends JsonValue>(input: {
    signerId: string;
    lei: string;
    payload: T;
  }): Promise<SignedJsonEnvelope<T>> {
    const canonicalPayload = canonicalizeJson(input.payload);
    return this.#runBridge("sign", { ...input, canonicalPayload });
  }

  async verifyJson<T extends JsonValue>(
    envelope: SignedJsonEnvelope<T>,
    options: { expectedRootAid?: string; expectedLei?: string } = {},
  ): Promise<VerificationResult<T>> {
    const expectedRootAid =
      options.expectedRootAid ?? (await this.getRootAid());
    return verifyEnvelope(
      envelope,
      { ...options, expectedRootAid },
      {
        pythonExecutable: this.pythonExecutable,
        stateDir: this.stateDir,
      },
    );
  }

  async #runBridge<T>(command: string, input: JsonObject | object): Promise<T> {
    return runBridge(command, input, {
      pythonExecutable: this.pythonExecutable,
      stateDir: this.stateDir,
      rootSeedEnvName: this.rootSeedEnvName,
    });
  }
}
