import { config as loadEnv } from "dotenv";
import { basename, dirname, resolve } from "node:path";

const moduleParent = dirname(import.meta.dirname);
const appRoot = basename(moduleParent) === "dist" ? dirname(moduleParent) : moduleParent;
const workspaceRoot = resolve(appRoot, "../..");

loadEnv({ path: resolve(workspaceRoot, ".env"), override: false, quiet: true });

export interface BrokerConfig {
  host: string;
  port: number;
  address: string;
  feeUsdc: number;
  quoteTtlSeconds: number;
  network: `${string}:${string}`;
  facilitatorUrl: string;
  facilitatorTimeoutMs: number;
  logLevel: string;
}

const numberFromEnv = (name: string, fallback: number) => {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) throw new Error(`${name} must be a finite number`);
  return value;
};

export function readConfig(): BrokerConfig {
  const loaded: BrokerConfig = {
    host: process.env.CUSTOMS_BROKER_HOST ?? "127.0.0.1",
    port: numberFromEnv("CUSTOMS_BROKER_PORT", 4021),
    address: process.env.CUSTOMS_BROKER_ADDRESS ?? "",
    feeUsdc: numberFromEnv("CUSTOMS_BROKER_FEE_USDC", 0.01),
    quoteTtlSeconds: numberFromEnv("CUSTOMS_BROKER_QUOTE_TTL_SECONDS", 300),
    network: (process.env.X402_NETWORK ?? "eip155:84532") as `${string}:${string}`,
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "https://x402.org/facilitator",
    facilitatorTimeoutMs: numberFromEnv("X402_FACILITATOR_TIMEOUT_MS", 30_000),
    logLevel: process.env.LOG_LEVEL ?? "info"
  };
  if (!Number.isSafeInteger(loaded.port) || loaded.port < 1 || loaded.port > 65_535) {
    throw new Error("CUSTOMS_BROKER_PORT must be an integer from 1 to 65535");
  }
  if (!Number.isSafeInteger(loaded.quoteTtlSeconds) || loaded.quoteTtlSeconds <= 0) {
    throw new Error("CUSTOMS_BROKER_QUOTE_TTL_SECONDS must be a positive integer");
  }
  if (!Number.isSafeInteger(loaded.facilitatorTimeoutMs) || loaded.facilitatorTimeoutMs <= 0) {
    throw new Error("X402_FACILITATOR_TIMEOUT_MS must be a positive integer");
  }
  return loaded;
}

export const config = readConfig();
