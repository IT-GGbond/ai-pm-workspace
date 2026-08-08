// app/api/pm/[id]/route.ts — 项目详情（工作台刷新恢复现场用）
//
// 请求:  GET /api/pm/:id
// 响应:  { project: Project + documents(sections) + agentLogs }
//
// 用途: 工作台直接刷新 /workspace/[id] 时，用此接口恢复
//       - 左侧 DocNav: project.documents
//       - 中间 DocumentView: documents[i].sections
//       - 右侧 AIPanel: agentLogs（历史思考过程）
//
// force-dynamic: 读取数据库，禁止预渲染

import { prisma } from "@/lib/prisma";

export const dynamic = "force-dynamic";

export async function GET(
  _req: Request,
  ctx: { params: Promise<{ id: string }> },
) {
  const { id } = await ctx.params;

  const project = await prisma.project.findUnique({
    where: { id },
    include: {
      documents: {
        orderBy: { type: "asc" },
        include: { sections: { orderBy: { order: "asc" } } },
      },
      agentLogs: { orderBy: { createdAt: "asc" } },
    },
  });

  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  return Response.json({ project });
}
