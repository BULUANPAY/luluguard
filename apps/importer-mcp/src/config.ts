import { config as loadEnv } from "dotenv";
import { resolve } from "node:path";

loadEnv({ path: resolve(import.meta.dirname, "../../../.env"), override: false, quiet: true });

export const config = {
  mcp: {
    host: process.env.MCP_HOST ?? "127.0.0.1",
    port: Number(process.env.MCP_PORT ?? 4020),
    apiKey: process.env.MCP_API_KEY ?? ""
  },
  customsBroker: {
    apiUrl: process.env.CUSTOMS_BROKER_API_URL ?? "http://127.0.0.1:4021",
    address: process.env.CUSTOMS_BROKER_ADDRESS ?? "",
    feeUsdc: Number(process.env.CUSTOMS_BROKER_FEE_USDC ?? 0.01)
  },
  importer: {
    address: process.env.IMPORTER_ADDRESS ?? "",
    privateKey: process.env.IMPORTER_PRIVATE_KEY ?? ""
  },
  payment: {
    maxUsdc: Number(process.env.MAX_PAYMENT_USDC ?? 1),
    humanApprovalAboveUsdc: Number(process.env.HUMAN_APPROVAL_ABOVE_USDC ?? 0)
  },
  x402: {
    network: process.env.X402_NETWORK ?? "eip155:84532"
  },
  log: { level: process.env.LOG_LEVEL ?? "info" }
} as const;
