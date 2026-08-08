// app/page.tsx — 首页（Server Component）
//
// 结构: 顶栏 → Hero（标题 + 需求输入框）→ 最近项目列表
// 项目列表直接查 Prisma（服务端查询，避免多一跳 API）
// 需求输入框是 client 组件，提交后跳转 /workspace/create?q=...

import { prisma } from "@/lib/prisma";
import { NewProjectForm } from "@/components/home/new-project-form";
import { DOC_TYPES } from "@/lib/workspace-types";

export const dynamic = "force-dynamic";

/** 相对时间（中文） */
function relTime(date: Date | string): string {
  const diff = Date.now() - new Date(date).getTime();
  const mins = Math.floor(diff / 60_000);
  if (mins < 1) return "刚刚";
  if (mins < 60) return `${mins} 分钟前`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `${hrs} 小时前`;
  const days = Math.floor(hrs / 24);
  if (days < 30) return `${days} 天前`;
  return new Date(date).toLocaleDateString();
}

export default async function Home() {
  const projects = await prisma.project.findMany({
    orderBy: { updatedAt: "desc" },
    take: 8,
    select: {
      id: true,
      name: true,
      description: true,
      status: true,
      updatedAt: true,
      _count: { select: { documents: true } },
    },
  });

  return (
    <div className="min-h-dvh bg-[#FAFAF7] text-foreground">
      {/* ==== 顶栏 ==== */}
      <header className="mx-auto flex h-14 max-w-4xl items-center justify-between px-6">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-7 items-center justify-center rounded-md bg-[#3456E6] text-xs font-bold text-white">
            PM
          </span>
          产品工作间
        </a>
        <span className="text-xs text-muted-foreground">AI Product Manager · LangGraph Multi-Agent</span>
      </header>

      {/* ==== Hero ==== */}
      <section className="mx-auto max-w-3xl px-6 pt-16 pb-12 text-center sm:pt-24">
        <p className="mb-4 inline-flex items-center gap-1.5 rounded-full border border-border bg-white px-3 py-1 text-xs text-muted-foreground">
          4 个 Agent 协作 · 你来做最终决策
        </p>
        <h1 className="text-balance text-3xl font-semibold leading-tight tracking-tight text-foreground sm:text-4xl">
          把产品想法，
          <br />
          做成一套完整方案
        </h1>
        <p className="mx-auto mt-3 max-w-md text-balance text-sm leading-6 text-muted-foreground">
          输入一个产品想法，Supervisor 拆解任务、Research 调研竞品、Writer
          撰写文档、Reviewer 质量把关——生成 PRD 与全套产品文档，每一篇都由你审阅拍板。
        </p>

        <div className="mx-auto mt-8 max-w-xl">
          <NewProjectForm />
          <p className="mt-2 text-left text-[11px] text-muted-foreground/70">
            无需登录 · 示例：「设计一个宠物社交 App」「做一款远程办公效率工具」
          </p>
        </div>
      </section>

      {/* ==== 最近项目 ==== */}
      <section className="mx-auto max-w-4xl px-6 pb-16">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold text-foreground">最近项目</h2>
          <span className="text-xs text-muted-foreground">{projects.length} 个</span>
        </div>

        {projects.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-white/60 px-6 py-12 text-center">
            <p className="text-sm font-medium text-foreground">还没有项目</p>
            <p className="mt-1 text-xs text-muted-foreground">在上方输入一个产品想法，开始你的第一个 AI 协作项目</p>
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2">
            {projects.map(p => (
              <li key={p.id}>
                <a
                  href={`/workspace/${p.id}`}
                  className="group block rounded-xl border border-border bg-white p-4 shadow-sm transition-all hover:-translate-y-px hover:border-[#3456E6]/40 hover:shadow-md"
                >
                  <div className="flex items-center gap-2">
                    <span className="truncate text-sm font-medium text-foreground">{p.name}</span>
                    <span
                      className={`ml-auto shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${
                        p.status === "completed"
                          ? "bg-emerald-50 text-[#1F7A4D]"
                          : "bg-blue-50 text-[#3456E6]"
                      }`}
                    >
                      {p.status === "completed" ? "已完成" : "进行中"}
                    </span>
                  </div>
                  <p className="mt-1 truncate text-xs text-muted-foreground">{p.description}</p>
                  <div className="mt-3 flex items-center gap-3 text-[11px] text-muted-foreground">
                    <span>{p._count.documents}/{DOC_TYPES.length} 份文档</span>
                    <span>·</span>
                    <span>{relTime(p.updatedAt)}</span>
                  </div>
                </a>
              </li>
            ))}
          </ul>
        )}
      </section>

      <footer className="border-t border-border/70 py-6 text-center text-[11px] text-muted-foreground">
        为 AI 应用开发面试准备 · Next.js 16 + LangGraph.js 1.x + Vercel AI SDK
      </footer>
    </div>
  );
}
