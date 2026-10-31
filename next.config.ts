import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  // The Vercel free plan has no image transformations left: every image is served as is, never through /_next/image.
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
