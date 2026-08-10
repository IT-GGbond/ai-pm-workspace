import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 部署依赖 standalone 模式: 构建产物自带运行时依赖, 不需要 node_modules
  output: "standalone",
};

export default nextConfig;
