// app/workspace/create/page.tsx — 新项目入口（Server Component）
//
// 从首页跳转而来: /workspace/create?q=产品想法
// 只负责把 searchParams.q 传给 WorkspaceShell 的 create 模式
// （WorkspaceShell 会 POST /api/pm/analyze 发起 Agent 执行，拿到 projectId 后 replace 到 /workspace/:id）

import { Suspense } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

export const dynamic = "force-dynamic";

async function CreateWorkspace({ q }: { q: string | null }) {
  return <WorkspaceShell projectId={null} initialRequest={q} />;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const { q } = await searchParams;
  const request = q?.trim() || null;

  // searchParams 是运行时数据 → 包一层 Suspense 提供加载态
  return (
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          正在加载工作台…
        </div>
      }
    >
      <CreateWorkspace q={request} />
    </Suspense>
  );
}
