// app/workspace/[id]/page.tsx — 项目工作台（Server Component）
//
// 访问 /workspace/:id → 服务端查 Project + Documents(Sections) + AgentLogs
// → 传给 WorkspaceShell 的 existing 模式，刷新页面可恢复现场
//
// Next.js 16: 动态路由 params 是 Promise，需 await（见 node_modules/next/dist/docs/…/dynamic-routes.md）

import { notFound } from "next/navigation";
import { prisma } from "@/lib/prisma";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const dynamic = "force-dynamic";

export default async function Page({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

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

  if (!project) notFound();

  return (
    <WorkspaceShell
      projectId={project.id}
      initialProject={project as unknown as import("@/components/workspace/workspace-shell").ProjectDetail}
    />
  );
}
