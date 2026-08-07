// lib/prisma.ts — Prisma Client 单例
// 防止 Next.js 热更新时创建多个 PrismaClient 实例（连接数耗尽）

import { PrismaClient } from "@prisma/client";

// 全局变量缓存，避免 dev 模式热更新重复创建
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

export const prisma =
  globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
