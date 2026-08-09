"use client";

// components/workspace/workspace-shell.tsx — 工作台主容器（三栏布局 + 会话状态）
//
// 两种进入模式:
//   1. create: 首页输入需求 → 本组件 POST /api/pm/analyze 发起 Agent 执行
//      → 收到 done 事件拿到 projectId → router.replace 到 /workspace/:id
//   2. existing: 直接访问 /workspace/:id → 初始数据来自 GET /api/pm/:id
//      → 用户在暂停点操作 ReviewBar → POST /api/pm/feedback 继续
//
// 布局:
//   ┌────────────────────────────────────────────────┐
//   │ Header: 项目名 · 状态徽章                       │
//   ├─────────┬────────────────────────┬─────────────┤
//   │ DocNav  │ DocumentView          │ AIPanel     │
//   └─────────┴────────────────────────┴─────────────┘

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useEventStream } from "@/hooks/use-event-stream";
import type { SSEEvent } from "@/lib/sse";
import type { DocData, DocMap, InterruptInfo, LogEntry, RunMode } from "@/lib/workspace-types";
import { AGENT_LABEL } from "@/lib/workspace-types";
import { DocNav } from "./doc-nav";
import { DocumentView } from "./document-view";
import { AIPanel } from "./ai-panel";

// ===== 由 server page 传入的初始数据 =====
export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  status: string;
  createdAt: string;
  updatedAt: string;
  documents: {
    id: string;
    type: string;
    title: string;
    status: string;
    updatedAt: string;
    sections: { title: string; content: string; order: number; status: string }[];
  }[];
  agentLogs: {
    id: string;
    agentName: string;
    action: string;
    input: string;
    output: string;
    toolCalls?: { tool: string; query: string }[] | null;
    createdAt: string;
  }[];
}

interface WorkspaceShellProps {
  projectId: string | null; // existing 模式: 项目 id；create 模式: null
  initialRequest?: string | null; // create 模式: 用户原始需求
  initialProject?: ProjectDetail | null; // existing 模式: DB 初始数据
}

/** AgentLog.agentName → 管线 node 名 */
const AGENT_NAME_TO_NODE: Record<string, string> = {
  Supervisor: "supervisor",
  Research: "research",
  Writer: "writer",
  Reviewer: "reviewer",
  HumanReview: "human_review",
};

/** DB documents 数组 → DocMap */
function toDocMap(docs: ProjectDetail["documents"]): DocMap {
  const map: DocMap = {};
  for (const d of docs) {
    map[d.type] = { type: d.type, title: d.title, status: d.status, sections: d.sections };
  }
  return map;
}

/** AgentLog → LogEntry（刷新后恢复时间线） */
function toLogs(logs: ProjectDetail["agentLogs"]): LogEntry[] {
  return logs.map((l, i) => ({
    id: `hist-${i}`,
    node: AGENT_NAME_TO_NODE[l.agentName] ?? l.agentName,
    status: "done",
    output: `${l.input} → ${l.output}`,
    toolCalls: l.toolCalls ?? undefined,
    at: i,
  }));
}

/** 节点输出 → 时间线可读摘要（与 server summarizeUpdate 对应，前端渲染用） */
function formatOutput(node: string, data: Record<string, unknown>): string {
  switch (node) {
    case "supervisor": {
      if (Array.isArray(data.tasks)) return `拆解 ${data.tasks.length} 个任务`;
      if (data.nextAgent) return `调度下一步 → ${AGENT_LABEL[String(data.nextAgent)] ?? data.nextAgent}`;
      return "更新计划";
    }
    case "research": {
      const r = (Array.isArray(data.researchResults) ? data.researchResults : []) as {
        query: string;
        sources: unknown[];
      }[];
      if (r.length) return r.map(x => `「${x.query}」${x.sources.length} 条`).join(" · ");
      return "搜索完成";
    }
    case "writer": {
      const docs = (data.documents ?? {}) as Record<string, DocData>;
      return Object.values(docs)
        .map(d => `「${d.title}」${d.sections.length} 节`)
        .join(" · ");
    }
    case "reviewer":
      return data.reviewPassed ? "质量审查通过" : `质量问题 ${(data.reviewIssues as unknown[])?.length ?? 0} 项`;
    default:
      return "人工审阅节点完成";
  }
}

export function WorkspaceShell({ projectId, initialRequest, initialProject }: WorkspaceShellProps) {
  const router = useRouter();

  // === 会话状态 ===
  const [mode, setMode] = useState<RunMode>("idle");
  const [projectIdState, setProjectId] = useState<string | null>(projectId);
  const [error, setError] = useState<string | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>(() => (initialProject ? toLogs(initialProject.agentLogs) : []));
  const [docs, setDocs] = useState<DocMap>(() => (initialProject ? toDocMap(initialProject.documents) : {}));
  const [currentType, setCurrentType] = useState<string | null>(
    () => (initialProject?.documents[0]?.type ?? null),
  );
  const [interrupt, setInterrupt] = useState<InterruptInfo | null>(null);
  const busyRef = useRef(false);

  const seqRef = useRef(logs.length);
  const nextSeq = () => ++seqRef.current;

  // === SSE 事件分发 ===
  const onEvent = useCallback(
    (evt: SSEEvent) => {
      switch (evt.type) {
        case "node_start": {
          setLogs(l => [...l, { id: `log-${nextSeq()}`, node: evt.node!, status: "active", at: seqRef.current }]);
          break;
        }
        case "node_output": {
          const data = (evt.data ?? {}) as Record<string, unknown>;
          setLogs(l => {
            // 把该节点最后一条 active 更新为 done，并附上摘要
            const copy = [...l];
            for (let i = copy.length - 1; i >= 0; i--) {
              if (copy[i].node === evt.node && copy[i].status === "active") {
                const toolCalls = Array.isArray(data.toolCalls)
                  ? (data.toolCalls as { tool: string; query: string }[])
                  : (data as { toolCalls?: { tool: string; query: string }[] }).toolCalls;
                copy[i] = { ...copy[i], status: "done", output: formatOutput(evt.node!, data), toolCalls };
                break;
              }
            }
            return copy;
          });
          // 提取文档更新 → 增量渲染
          const newDocs = data.documents as Record<string, DocData> | undefined;
          if (newDocs && typeof newDocs === "object") {
            setDocs(prev => {
              const merged: DocMap = { ...prev };
              for (const [type, doc] of Object.entries(newDocs)) {
                merged[type] = { ...(prev[type] ?? {}), ...doc };
                // 首个文档自动选中
                if (!currentType) setCurrentType(type);
              }
              return merged;
            });
          }
          break;
        }
        case "interrupt": {
          setInterrupt({
            documentType: evt.documentType ?? null,
            documentTitle: evt.documentTitle ?? "文档",
            message: evt.message ?? "文档已生成，请审阅",
          });
          if (evt.documentType) setCurrentType(evt.documentType);
          setLogs(l => [
            ...l,
            { id: `log-${nextSeq()}`, node: "human_review", status: "waiting", output: `等待审阅「${evt.documentTitle ?? "文档"}」`, at: seqRef.current },
          ]);
          break;
        }
        case "done": {
          if (evt.projectId && !projectId) {
            // create 模式: 拿到 projectId → 替换 URL，刷新后可恢复现场
            setProjectId(evt.projectId);
            busyRef.current = false;
            router.replace(`/workspace/${evt.projectId}`);
          }
          if (evt.status === "completed") setMode("completed");
          else if (evt.status === "waiting_review") setMode("waiting_review");
          break;
        }
        case "error":
          setMode("error");
          setError(evt.message ?? "Agent 执行失败");
          break;
      }
    },
    [currentType, projectId, router],
  );

  const { start } = useEventStream({
    onEvent,
    onError: msg => {
      setMode("error");
      setError(msg);
    },
  });

  // === create 模式: 首次渲染自动发起 analyze ===
  const launchedRef = useRef(false);
  useEffect(() => {
    if (!initialRequest || launchedRef.current) return;
    launchedRef.current = true;
    setMode("running");
    setLogs(l => [...l, { id: `log-${nextSeq()}`, node: "supervisor", status: "active", at: seqRef.current }]);
    start("/api/pm/analyze", { userRequest: initialRequest });
  }, [initialRequest, start]);

  // === existing 模式: 暂停态恢复（刷新后无 interrupt 信息，用 DB 文档状态推断）===
  //
  // 本工作流是"逐篇文档 HITL": analyze 首轮只生成第一篇 PRD 就停在 human_review，
  // 其余文档在 DB 中根本不存在（不是 pending，是还没有记录）。
  // 所以不能只看"已存在文档的状态"，中断点 = 最新一篇已生成(approved)的文档。
  useEffect(() => {
    if (!initialProject) return;

    if (initialProject.status === "completed") {
      setMode("completed");
      return;
    }

    if (initialProject.status === "in_progress") {
      // 中断点推断: 逐篇 HITL 里，analyze 首轮生成 PRD 后停在 human_review，
      // 此时该文档状态是 "review"（生成完毕等用户审阅），不是 approved/pending。
      // 所以优先找最新一篇 review 文档；没有 review 才退回到 pending（极端情况）。
      const inReview = initialProject.documents
        .filter(d => d.status === "review")
        .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0];
      const target = inReview ?? initialProject.documents.find(d => d.status === "pending");
      if (target) {
        setInterrupt({
          documentType: target.type ?? null,
          documentTitle: target.title ?? "文档",
          message: "上次执行在此处暂停，请选择操作继续",
        });
        setCurrentType(target.type ?? null);
        setMode("waiting_review");
      }
    }
  }, [initialProject]);

  // 注意: 不再在组件卸载时 abort()。
  //   React StrictMode（App Router 默认开启）会 mount → cleanup → remount，
  //   若 cleanup 里 abort，首轮 analyze 流会被杀掉且 launchedRef 挡住重发 → 页面永久卡执行中。
  //   连接由 start() 内部管理: feedback 续跑时自行 abort 旧连接；用户真正离开页面时后端幂等，孤儿请求无害。

  // === 用户审阅动作 → POST /api/pm/feedback ===
  const sendFeedback = useCallback(
    async (action: "approve" | "modify" | "rewrite", feedback?: string) => {
      if (!projectIdState || busyRef.current) return;
      busyRef.current = true;
      setMode("running");
      setInterrupt(null);
      await start("/api/pm/feedback", { projectId: projectIdState, action, feedback });
      busyRef.current = false;
    },
    [projectIdState, start],
  );

  const statusLabel = useMemo(() => {
    switch (mode) {
      case "completed": return "已完成";
      case "running": return "执行中";
      case "waiting_review": return "待审阅";
      case "error": return "执行出错";
      default: return "就绪";
    }
  }, [mode]);

  const projectName = initialProject?.name ?? initialRequest?.slice(0, 20) ?? "AI 产品经理";
  const projectDesc = initialProject?.description ?? initialRequest ?? "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ==== Header ==== */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <a href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            PM
          </span>
          产品工作间
        </a>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-sm font-medium">{projectName}</span>
        {projectDesc && (
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">· {projectDesc}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge mode={mode} />
          <a
            href="/"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            新建项目
          </a>
        </div>
      </header>

      {/* ==== 三栏主体 ==== */}
      <div className="flex min-h-0 flex-1">
        {/* 左: 文档导航 */}
        <aside className="w-52 shrink-0 border-r border-border bg-card/60 max-md:hidden">
          <DocNav docs={docs} currentType={currentType} onSelect={setCurrentType} />
        </aside>

        {/* 中: 文档渲染 */}
        {/* overflow-y-auto: 中间区独立滚动，长文档不会被外层 h-dvh overflow-hidden 裁剪 */}
        <main className="flex min-w-0 flex-1 flex-col overflow-y-auto">
          <DocumentView doc={currentType ? docs[currentType] : undefined} />
        </main>

        {/* 右: AI 面板（思考管线 + 日志 + 审阅栏） */}
        <aside className="flex w-[330px] shrink-0 flex-col border-l border-border bg-card/40 max-lg:hidden">
          <AIPanel
            logs={logs}
            interrupt={interrupt}
            mode={mode}
            error={error}
            onApprove={() => sendFeedback("approve")}
            onModify={(fb) => sendFeedback("modify", fb)}
            onRewrite={(fb) => sendFeedback("rewrite", fb)}
            onDismissError={() => setMode(projectIdState ? "waiting_review" : "idle")}
          />
        </aside>
      </div>
    </div>
  );
}

/** Header 状态徽章 */
function StatusBadge({ mode }: { mode: RunMode }) {
  const styles: Record<RunMode, string> = {
    idle: "bg-muted text-muted-foreground",
    running: "bg-blue-50 text-[#3456E6] dark:bg-blue-500/10",
    waiting_review: "bg-amber-50 text-[#B7791F] dark:bg-amber-500/10",
    completed: "bg-emerald-50 text-[#1F7A4D] dark:bg-emerald-500/10",
    error: "bg-red-50 text-[#C4461F] dark:bg-red-500/10",
  };
  const labels: Record<RunMode, string> = {
    idle: "就绪",
    running: "执行中",
    waiting_review: "待审阅",
    completed: "已完成",
    error: "出错",
  };
  return (
    <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${styles[mode]}`}>
      {mode === "running" ? (
        <span className="inline-flex items-center gap-1.5">
          <span className="size-1.5 animate-pulse rounded-full bg-current" />
          {labels[mode]}
        </span>
      ) : (
        labels[mode]
      )}
    </span>
  );
}
