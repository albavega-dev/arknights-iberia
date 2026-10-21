import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  agentRules: false,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/PuppiizSunniiz/Arknight-Images/main/**",
      },
      {
        protocol: "https",
        hostname: "web.hycdn.cn",
        pathname: "/arknights/game/assets/char/portrait/**",
      },
      {
        protocol: "https",
        hostname: "static.wikia.nocookie.net",
        pathname: "/mrfz/images/**",
      },
      {
        protocol: "https",
        hostname: "raw.githubusercontent.com",
        pathname: "/PuppiizSunniiz/Arknight-Images/**",
      },
    ],
  },
};

export default nextConfig;
