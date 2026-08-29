import { config as loadEnv } from "dotenv";
import { basename, dirname, resolve } from "node:path";

const moduleParent = dirname(import.meta.dirname);
const appRoot =
  basename(moduleParent) === "dist" ? dirname(moduleParent) : moduleParent;

loadEnv({ path: resolve(appRoot, ".env"), override: false, quiet: true });

export const config = {
  mcp: {
    host: process.env.MCP_HOST ?? "127.0.0.1",
    port: Number(process.env.MCP_PORT ?? 4020),
    apiKey: process.env.MCP_API_KEY ?? "",
  },
  policyAdmin: {
    apiKey: process.env.POLICY_ADMIN_API_KEY ?? "",
  },
  customsBroker: {
    apiUrl: process.env.CUSTOMS_BROKER_API_URL ?? "http://127.0.0.1:4021",
    address: process.env.CUSTOMS_BROKER_ADDRESS ?? "",
    feeUsdc: Number(process.env.CUSTOMS_BROKER_FEE_USDC ?? 0.01),
  },
  importer: {
    address: process.env.IMPORTER_ADDRESS ?? "",
    privateKey: process.env.IMPORTER_PRIVATE_KEY ?? "",
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
    maxUsdc: Number(process.env.MAX_PAYMENT_USDC ?? 1),
    maxDailyUsdc: Number(process.env.MAX_DAILY_PAYMENT_USDC ?? 5),
    maxPaymentsPerHour: Number(process.env.MAX_PAYMENTS_PER_HOUR ?? 5),
    humanApprovalAboveUsdc: Number(process.env.HUMAN_APPROVAL_ABOVE_USDC ?? 0),
  },
  x402: {
    network: process.env.X402_NETWORK ?? "eip155:84532",
  },
  audit: {
    enabled: process.env.AUDIT_LOG_ENABLED !== "false",
    path: process.env.AUDIT_LOG_PATH ?? resolve(appRoot, "logs/audit.jsonl"),
    maxValueLength: Number(process.env.AUDIT_LOG_MAX_VALUE_LENGTH ?? 8_000),
  },
  log: { level: process.env.LOG_LEVEL ?? "info" },
} as const;
