"use client";

// components/workspace/doc-nav.tsx — 左侧文档导航
//
// 5 种文档类型的固定列表，按生成状态显示徽章
// 未生成的文档显示为灰色占位；点击切换中间 DocumentView

import { cn } from "@/lib/utils";
import type { DocMap } from "@/lib/workspace-types";
import { DOC_TYPES, DOC_STATUS_LABEL } from "@/lib/workspace-types";

interface DocNavProps {
  docs: DocMap;
  currentType: string | null;
  onSelect: (type: string) => void;
}

/** 文档状态 → 徽章配色 */
const statusStyles: Record<string, string> = {
  approved: "bg-emerald-50 text-[#1F7A4D] dark:bg-emerald-500/10",
  review: "bg-amber-50 text-[#B7791F] dark:bg-amber-500/10",
  generating: "bg-blue-50 text-[#3456E6] dark:bg-blue-500/10",
  pending: "bg-muted text-muted-foreground",
};

export function DocNav({ docs, currentType, onSelect }: DocNavProps) {
  return (
    <nav className="flex h-full flex-col">
      <div className="px-3 pt-4 pb-2 text-xs font-medium tracking-wide text-muted-foreground">
        文档
      </div>
      <div className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {DOC_TYPES.map(({ type, label, desc }) => {
          const doc = docs[type];
          const status = doc?.status ?? "pending";
          const selected = currentType === type;
          return (
            <button
              key={type}
              type="button"
              onClick={() => onSelect(type)}
              className={cn(
                "group flex w-full flex-col gap-0.5 rounded-lg border-l-2 px-2.5 py-2 text-left transition-colors",
                selected
                  ? "border-primary bg-muted/70"
                  : "border-transparent hover:bg-muted/40",
              )}
            >
              <span className="flex items-center gap-2">
                <span
                  className={cn(
                    "text-[13px] font-medium",
                    doc ? "text-foreground" : "text-muted-foreground",
                  )}
                >
                  {label}
                </span>
                <span
                  className={cn(
                    "ml-auto rounded-full px-1.5 py-px text-[10px] font-medium",
                    statusStyles[status] ?? statusStyles.pending,
                  )}
                >
                  {DOC_STATUS_LABEL[status] ?? status}
                </span>
              </span>
              <span className="truncate text-[11px] text-muted-foreground">{desc}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
