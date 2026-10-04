import type { NextConfig } from "next";
import path from "node:path";
const config: NextConfig = {
  distDir: process.env.BORAN_NEXT_DIST_DIR ?? '.next',
  output: "standalone", outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  reactStrictMode: true, poweredByHeader: false, agentRules: false,
  logging: { incomingRequests: false },
  transpilePackages: ["@boran/ui", "@boran/contracts", "@boran/db", "@boran/domain"], images: { remotePatterns: [] },
  async headers() { return [{ source: "/:path*", headers: [
    { key: "X-Content-Type-Options", value: "nosniff" }, { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
    { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
    { key: "Content-Security-Policy", value: "default-src 'self'; base-uri 'self'; object-src 'none'; frame-src 'none'; frame-ancestors 'none'; form-action 'self'; img-src 'self'; media-src 'self'; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'" },
  ] }]; },
};
export default config;
