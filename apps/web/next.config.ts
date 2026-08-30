import { existsSync } from "node:fs";
import path from "node:path";
import { loadEnvFile } from "node:process";
import type { NextConfig } from "next";

const workspaceRoot = path.join(import.meta.dirname, "../..");
const rootEnvPath = path.join(workspaceRoot, ".env");

if (existsSync(rootEnvPath)) loadEnvFile(rootEnvPath);

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  serverExternalPackages: ["@repo/vlei-json-signing"],
};

export default nextConfig;
