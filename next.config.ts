import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 多人并行跑 dev server 时各用各的输出目录，见 docs/CONTRACT.md
  distDir: process.env.NEXT_DIST_DIR || ".next",
};

export default nextConfig;
