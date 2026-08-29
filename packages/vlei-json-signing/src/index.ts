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
} from "./types.js";

export type * from "./types.js";
export { canonicalizeJson } from "./canonicalize.js";

interface BridgeResponse<T> {
  ok: boolean;
  result?: T;
  error?: { code: string; message: string };
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
  readonly #bridgePath: string;
  readonly #sandboxScriptsPath: string;

  constructor(options: VleiJsonSigningOptions = {}) {
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
    this.stateDir = path.resolve(options.stateDir ?? ".vlei-json-signing");
    this.pythonExecutable = options.pythonExecutable ?? "python3";
    this.rootSeedEnvName = options.rootSeedEnvName ?? "VLEI_ROOT_SEED";
    this.#bridgePath = path.join(packageRoot, "python", "bridge.py");
    this.#sandboxScriptsPath = path.resolve(
      packageRoot,
      "..",
      "..",
      "vendor",
      "vlei-sandbox",
      "scripts",
    );
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
    if (envelope === null || typeof envelope !== "object") {
      return {
        valid: false,
        errors: [
          { code: "ENVELOPE_INVALID", message: "Envelope must be an object" },
        ],
      };
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
    return this.#runBridge("verify", {
      envelope,
      canonicalPayload,
      expectedRootAid: options.expectedRootAid,
      expectedLei: options.expectedLei,
    });
  }

  async #runBridge<T>(command: string, input: JsonObject | object): Promise<T> {
    const request = JSON.stringify({
      command,
      input,
      rootSeedEnvName: this.rootSeedEnvName,
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];

    const child = spawn(
      this.pythonExecutable,
      [
        this.#bridgePath,
        "--sandbox-scripts",
        this.#sandboxScriptsPath,
        "--state-dir",
        this.stateDir,
      ],
      { env: process.env, stdio: ["pipe", "pipe", "pipe"] },
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
        error instanceof Error
          ? error.message
          : "Failed to start Python bridge",
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
}
