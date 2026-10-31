import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // Every image is served as is, never through /_next/image.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
