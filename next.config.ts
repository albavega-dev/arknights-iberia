import type { NextConfig } from "next";
import { securityHeaderRules } from "./src/game-data/security-headers";

const nextConfig: NextConfig = {
  agentRules: false,
  poweredByHeader: false,
  async headers() {
    return securityHeaderRules(process.env.NODE_ENV === "development");
  },
  // The Vercel free plan has no image transformations left: every image is served as is, never through /_next/image.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
