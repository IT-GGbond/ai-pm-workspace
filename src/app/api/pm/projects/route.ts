// app/api/pm/projects/route.ts — 项目列表（首页用）
//
// 请求:  GET /api/pm/projects
// 响应:  { projects: [{ id, name, description, status, updatedAt, _count }] }
//
// force-dynamic: 读取数据库，禁止预渲染/缓存（首页需要最新状态）

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 20,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      updatedAt: true,
      _count: { select: { documents: true } },
    },
  });

  return Response.json({ projects });
}
