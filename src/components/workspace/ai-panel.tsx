"use client";

// components/workspace/ai-panel.tsx — 右侧 AI 思考面板（Signature 区域）
//
// 自上而下三块:
//   1. AgentPipeline — 节点管线: supervisor → research → writer → reviewer → human
//      （本项目最有辨识度的元素: 把 Agent 协作过程可视化成一站一站的工序）
//   2. LogStream      — 实时日志流: 每个节点的输入/输出/工具调用
//   3. FooterZone     — 底部状态区: 审阅栏 / 执行提示 / 完成横幅 / 错误条
//
// 节点状态由日志推导: 最后一条对应节点的 status 决定（pending/active/done/waiting）

import { Fragment } from "react";
import {
  AlertTriangle,
  Check,
  LoaderCircle,
  PenLine,
  Search,
  ShieldCheck,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { InterruptInfo, LogEntry, RunMode } from "@/lib/workspace-types";
import { AGENT_LABEL, AGENT_ORDER } from "@/lib/workspace-types";
import { ReviewBar } from "./review-bar";

interface AIPanelProps {
  logs: LogEntry[];
  interrupt: InterruptInfo | null;
  mode: RunMode;
  error: string | null;
  onApprove: () => void;
  onModify: (feedback: string) => void;
  onRewrite: (feedback: string) => void;
  onDismissError: () => void;
}

/** 节点图标映射 */
const NODE_ICON: Record<string, typeof Sparkles> = {
  supervisor: Sparkles,
  research: Search,
  writer: PenLine,
  reviewer: ShieldCheck,
  human_review: UserRound,
};

/** 从日志推导节点当前状态（倒序找最后一条） */
function nodeStatus(
  node: string,
  logs: LogEntry[],
): "pending" | "active" | "done" | "waiting" | "error" {
  for (let i = logs.length - 1; i >= 0; i--) {
    if (logs[i].node === node) return logs[i].status;
  }
  return "pending";
}

export function AIPanel({
  logs,
  interrupt,
  mode,
  error,
  onApprove,
  onModify,
  onRewrite,
  onDismissError,
}: AIPanelProps) {
  return (
    <div className="flex h-full flex-col">
      {/* ==== 1. Agent 节点管线（Signature）==== */}
      <div className="shrink-0 border-b border-border px-3 pt-3 pb-2">
        <div className="mb-2 flex items-center gap-1.5 text-[11px] font-medium tracking-wide text-muted-foreground">
          <Sparkles className="size-3" />
          AGENT 协作管线
        </div>
        <div className="flex items-start">
          {AGENT_ORDER.map((node, i) => {
            const status = nodeStatus(node, logs);
            return (
              <Fragment key={node}>
                {i > 0 && <Connector lit={status !== "pending" && nodeStatus(AGENT_ORDER[i - 1], logs) !== "pending"} />}
                <PipelineNode node={node} status={status} />
              </Fragment>
            );
          })}
        </div>
      </div>

      {/* ==== 2. 实时日志流 ==== */}
      <ScrollArea className="min-h-0 flex-1">
        <div className="flex flex-col gap-1 px-3 py-3">
          {logs.length === 0 && mode === "idle" ? (
            <EmptyLogs />
          ) : (
            logs.map(log => <LogRow key={log.id} log={log} />)
          )}
        </div>
      </ScrollArea>

      {/* ==== 3. 底部状态区 ==== */}
      <div className="shrink-0">
        {mode === "waiting_review" && interrupt && (
          <ReviewBar
            interrupt={interrupt}
            busy={false}
            onApprove={onApprove}
            onModify={onModify}
            onRewrite={onRewrite}
          />
        )}
        {mode === "running" && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-[#3456E6]">
            <LoaderCircle className="size-4 animate-spin" />
            Agent 执行中，文档将逐步写入…
          </div>
        )}
        {mode === "completed" && (
          <div className="flex items-center gap-2 border-t border-border px-4 py-3 text-xs text-[#1F7A4D]">
            <Check className="size-4" />
            全部文档已审阅完成
          </div>
        )}
        {mode === "error" && (
          <div className="flex items-start gap-2 border-t border-border px-4 py-3">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-[#C4461F]" />
            <p className="min-w-0 flex-1 text-xs leading-4 text-[#C4461F]">{error ?? "执行出错"}</p>
            <button onClick={onDismissError} className="text-muted-foreground hover:text-foreground">
              <X className="size-3.5" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ===== 管线节点 =====

const NODE_STATUS_STYLE: Record<string, string> = {
  pending: "border-border text-muted-foreground",
  active: "border-[#3456E6]/50 text-[#3456E6]",
  done: "border-[#3456E6] bg-[#3456E6] text-white",
  waiting: "border-[#B7791F]/50 bg-amber-50 text-[#B7791F] dark:bg-amber-500/10",
  error: "border-[#C4461F]/50 bg-red-50 text-[#C4461F] dark:bg-red-500/10",
};

function PipelineNode({ node, status }: { node: string; status: string }) {
  const Icon = NODE_ICON[node] ?? Sparkles;
  return (
    <div className="flex w-[52px] shrink-0 flex-col items-center gap-1">
      <span
        className={cn(
          "flex size-8 items-center justify-center rounded-full border transition-all duration-300",
          NODE_STATUS_STYLE[status] ?? NODE_STATUS_STYLE.pending,
        )}
      >
        {status === "done" ? (
          <Check className="size-4" />
        ) : status === "active" ? (
          <span className="relative flex size-4 items-center justify-center">
            <span className="absolute inline-flex size-4 animate-ping rounded-full bg-current opacity-40" />
            <Icon className="relative size-4" />
          </span>
        ) : status === "waiting" ? (
          <span className="relative flex size-4 items-center justify-center">
            <span className="absolute inline-flex size-4 animate-pulse rounded-full bg-current opacity-30" />
            <Icon className="relative size-4" />
          </span>
        ) : (
          <Icon className="size-4" />
        )}
      </span>
      <span
        className={cn(
          "text-center text-[10px] leading-tight",
          status === "done" || status === "active" || status === "waiting"
            ? "text-foreground"
            : "text-muted-foreground",
        )}
      >
        {AGENT_LABEL[node] ?? node}
      </span>
    </div>
  );
}

/** 节点间连接线（前一个节点已点亮则点亮） */
function Connector({ lit }: { lit: boolean }) {
  return (
    <div className="mt-4 h-px min-w-2 flex-1 transition-colors duration-300"
      style={{ backgroundColor: lit ? "var(--primary)" : "var(--border)" }}
    />
  );
}

// ===== 日志行 =====

function LogRow({ log }: { log: LogEntry }) {
  const Icon = NODE_ICON[log.node] ?? Sparkles;
  return (
    <div
      className={cn(
        "rounded-lg border border-transparent px-2.5 py-2 transition-colors",
        log.status === "active" && "border-[#3456E6]/30 bg-[#3456E6]/5",
        log.status === "waiting" && "border-[#B7791F]/30 bg-amber-50/60 dark:bg-amber-500/5",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("size-3.5 shrink-0", log.status === "active" || log.status === "done" ? "text-[#3456E6]" : log.status === "waiting" ? "text-[#B7791F]" : "text-muted-foreground")} />
        <span className="min-w-0 flex-1 truncate text-xs text-foreground/90">
          {log.output ?? AGENT_LABEL[log.node] ?? log.node}
        </span>
        {log.status === "active" && (
          <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-[#3456E6]" />
        )}
        {log.status === "waiting" && <span className="shrink-0 text-[10px] text-[#B7791F]">⏸ 待审</span>}
      </div>
      {log.toolCalls && log.toolCalls.length > 0 && (
        <div className="mt-1.5 space-y-0.5 pl-5.5">
          {log.toolCalls.map((t, i) => (
            <div key={i} className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
              <span className="rounded bg-muted px-1 py-px font-mono text-[10px]">🔍 {t.tool}</span>
              <span className="truncate">{t.query}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ===== 空状态 =====

function EmptyLogs() {
  return (
    <div className="px-2 py-6 text-center">
      <p className="text-xs text-muted-foreground">
        Agent 的每一步思考都会显示在这里
      </p>
    </div>
  );
}
