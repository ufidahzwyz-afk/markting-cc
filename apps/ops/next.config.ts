import type { NextConfig } from "next";
import path from "node:path";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  reactStrictMode: true,
  poweredByHeader: false,
  agentRules: false,
  devIndicators: false,
  logging: { incomingRequests: false },
  transpilePackages: ["@boran/ui", "@boran/domain", "@boran/contracts", "@boran/connectors", "@boran/ai", "@boran/db"],
  serverExternalPackages: ["pg", "@electric-sql/pglite"],
  images: { remotePatterns: [] },
};

export default nextConfig;
