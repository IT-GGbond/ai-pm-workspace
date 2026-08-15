import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署依赖 standalone 模式: 构建产物自带运行时依赖, 不需要 node_modules
  // 注意: Next.js 16.3 + Vercel 平台 adapter + standalone 同时启用会触发
  //       上游回归 (#93684): Vercel 构建跳过生成 next-server.js.nft.json,
  //       但 standalone finalizer 仍要读取 → onBuildComplete 阶段 ENOENT 崩溃。
  //       因此 Vercel 上禁用 standalone (平台自动处理运行时依赖), 其他环境保留。
  output: process.env.VERCEL ? undefined : "standalone",
};

export default nextConfig;
