import path from "node:path";
import type { NextConfig } from "next";

const workspaceRoot = path.join(import.meta.dirname, "../..");

const nextConfig: NextConfig = {
  outputFileTracingRoot: workspaceRoot,
  serverExternalPackages: ["@repo/vlei-json-signing"],
};

export default nextConfig;
