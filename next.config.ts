import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Cloudflare Pages automatically uses OpenNext adapter when deploying via wrangler
  // No additional config needed for API routes
};

export default nextConfig;
