import { config as loadEnv } from "dotenv";
import { basename, dirname, resolve } from "node:path";

const moduleParent = dirname(import.meta.dirname);
const appRoot =
  basename(moduleParent) === "dist" ? dirname(moduleParent) : moduleParent;

loadEnv({ path: resolve(appRoot, ".env"), override: false, quiet: true });

interface NumberOptions {
  integer?: boolean;
  min?: number;
  max?: number;
}

export function parseEnvironmentNumber(
  name: string,
  raw: string | undefined,
  fallback: number,
  options: NumberOptions = {},
): number {
  const value = raw === undefined || raw.trim() === "" ? fallback : Number(raw);
  const { integer = false, min = Number.NEGATIVE_INFINITY, max = Number.POSITIVE_INFINITY } = options;
  if (
    !Number.isFinite(value) ||
    (integer && !Number.isInteger(value)) ||
    value < min ||
    value > max
  ) {
    const constraints = [
      integer && "an integer",
      Number.isFinite(min) && `at least ${min}`,
      Number.isFinite(max) && `at most ${max}`,
    ].filter(Boolean).join(", ");
    throw new Error(
      `${name} must be a finite number${constraints ? ` (${constraints})` : ""}`,
    );
  }
  return value;
}

export const config = {
  mcp: {
    host: process.env.MCP_HOST ?? "127.0.0.1",
    port: parseEnvironmentNumber("MCP_PORT", process.env.MCP_PORT, 4020, {
      integer: true,
      min: 1,
      max: 65_535,
    }),
    apiKey: process.env.MCP_API_KEY ?? "",
  },
  policyAdmin: {
    apiKey: process.env.POLICY_ADMIN_API_KEY ?? "",
  },
  customsBroker: {
    apiUrl: process.env.CUSTOMS_BROKER_API_URL ?? "http://127.0.0.1:4021",
    address: process.env.CUSTOMS_BROKER_ADDRESS ?? "",
    feeUsdc: parseEnvironmentNumber(
      "CUSTOMS_BROKER_FEE_USDC",
      process.env.CUSTOMS_BROKER_FEE_USDC,
      0.01,
      { min: 0 },
    ),
  },
  importer: {
    address: process.env.IMPORTER_ADDRESS ?? "",
    privateKey: process.env.IMPORTER_PRIVATE_KEY ?? "",
    lei: process.env.IMPORTER_LEI ?? "8755001ELOZEL05BVX22",
  },
  vlei: {
    expectedRootAid: process.env.VLEI_EXPECTED_ROOT_AID ?? "",
  },
  signer: {
    provider: process.env.SIGNER_PROVIDER ?? "private-key",
    awsKms: {
      keyId: process.env.AWS_KMS_KEY_ID ?? "",
      region: process.env.AWS_REGION ?? "",
      endpoint: process.env.AWS_KMS_ENDPOINT,
    },
  },
  payment: {
    maxUsdc: parseEnvironmentNumber(
      "MAX_PAYMENT_USDC",
      process.env.MAX_PAYMENT_USDC,
      1,
      { min: 0 },
    ),
    maxDailyUsdc: parseEnvironmentNumber(
      "MAX_DAILY_PAYMENT_USDC",
      process.env.MAX_DAILY_PAYMENT_USDC,
      5,
      { min: 0 },
    ),
    maxPaymentsPerHour: parseEnvironmentNumber(
      "MAX_PAYMENTS_PER_HOUR",
      process.env.MAX_PAYMENTS_PER_HOUR,
      5,
      { integer: true, min: 1 },
    ),
    humanApprovalAboveUsdc: parseEnvironmentNumber(
      "HUMAN_APPROVAL_ABOVE_USDC",
      process.env.HUMAN_APPROVAL_ABOVE_USDC,
      0,
      { min: 0 },
    ),
  },
  x402: {
    network: process.env.X402_NETWORK ?? "eip155:84532",
  },
  audit: {
    enabled: process.env.AUDIT_LOG_ENABLED !== "false",
    path: process.env.AUDIT_LOG_PATH ?? resolve(appRoot, "logs/audit.jsonl"),
    maxValueLength: parseEnvironmentNumber(
      "AUDIT_LOG_MAX_VALUE_LENGTH",
      process.env.AUDIT_LOG_MAX_VALUE_LENGTH,
      8_000,
      { integer: true, min: 1 },
    ),
  },
  log: { level: process.env.LOG_LEVEL ?? "info" },
} as const;
