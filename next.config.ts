import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    // Document uploads go through a server action. Files are capped at 4 MB
    // (Vercel limits request bodies to ~4.5 MB); leave room for form overhead.
    serverActions: { bodySizeLimit: "4.5mb" },
  },
};

export default nextConfig;
