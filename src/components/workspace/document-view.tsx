"use client";

// components/workspace/document-view.tsx — 中间文档渲染区
//
// 渲染选中文档: 标题 + 状态徽章 + 章节列表（Markdown）
// 空状态: 无选中文档 / 文档未生成 / 生成中 → 给方向性引导

import { cn } from "@/lib/utils";
import type { DocData } from "@/lib/workspace-types";
import { DOC_STATUS_LABEL } from "@/lib/workspace-types";
import { Markdown } from "@/components/markdown";

interface DocumentViewProps {
  doc?: DocData;
}

const STATUS_COLOR: Record<string, string> = {
  approved: "text-[#1F7A4D]",
  review: "text-[#B7791F]",
  generating: "text-[#3456E6]",
  pending: "text-muted-foreground",
};

export function DocumentView({ doc }: DocumentViewProps) {
  // === 空状态: 还没有任何文档 ===
  if (!doc) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <div className="flex size-12 items-center justify-center rounded-xl border border-border bg-card text-2xl">
          📄
        </div>
        <div className="text-sm font-medium text-foreground">文档等待生成</div>
        <p className="max-w-xs text-xs leading-5 text-muted-foreground">
          Agent 正在拆解需求、调研竞品。生成第一篇文档后会自动显示在这里。
        </p>
      </div>
    );
  }

  // === 空章节: 生成中 ===
  if (!doc.sections.length) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 px-8 text-center">
        <span className="flex items-center gap-2 text-sm font-medium text-[#3456E6]">
          <span className="size-2 animate-pulse rounded-full bg-current" />
          {doc.title} 撰写中…
        </span>
      </div>
    );
  }

  return (
    <article className="mx-auto w-full max-w-3xl px-8 py-8">
      {/* 文档标题 */}
      <header className="mb-6">
        <div className="flex items-center gap-2">
          <h1 className="text-xl font-semibold tracking-tight text-foreground">{doc.title}</h1>
          <span
            className={cn(
              "rounded-full px-2.5 py-0.5 text-xs font-medium",
              STATUS_COLOR[doc.status] ?? "text-muted-foreground",
            )}
          >
            {DOC_STATUS_LABEL[doc.status] ?? doc.status}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted-foreground">
          共 {doc.sections.length} 个章节 · 由 Writer Agent 生成，Reviewer Agent 审阅
        </p>
      </header>

      {/* 章节列表 */}
      <div className="space-y-7">
        {doc.sections.map((section, i) => (
          <section key={`${section.order}-${i}`} className="group">
            {/* 章节标题行（含审阅状态点） */}
            <div className="mb-1 flex items-center gap-2">
              <span className="text-xs font-medium text-muted-foreground/70">
                {String(i + 1).padStart(2, "0")}
              </span>
              <span className="text-[13px] font-semibold text-foreground">{section.title}</span>
              <SectionStatusDot status={section.status} />
            </div>
            <div className="border-l-2 border-border/70 pl-4 transition-colors group-hover:border-primary/30">
              <Markdown content={section.content} />
            </div>
          </section>
        ))}
      </div>
    </article>
  );
}

/** 章节审阅状态小圆点 */
function SectionStatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    approved: "bg-[#1F7A4D]",
    review: "bg-[#B7791F]",
    draft: "bg-muted-foreground/40",
  };
  return <span className={cn("size-1.5 rounded-full", colors[status] ?? "bg-muted-foreground/40")} />;
}
