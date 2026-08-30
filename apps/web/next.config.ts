import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  outputFileTracingRoot: path.join(process.cwd(), "../.."),
  serverExternalPackages: ["@repo/vlei-json-signing"],
};

export default nextConfig;
