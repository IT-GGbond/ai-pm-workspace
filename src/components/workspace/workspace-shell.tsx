"use client";

// components/workspace/workspace-shell.tsx — 工作台主容器（三栏布局 + 会话状态）
//
// 两种进入模式:
//   1. create: 首页输入需求 → 本组件 POST /api/pm/analyze 发起 Agent 执行
//      → 收到 done 事件拿到 projectId → router.replace 到 /workspace/:id
//   2. existing: 直接访问 /workspace/:id → workspace/[id]/page.tsx（Server 组件）
//      → 在服务端直查 Prisma 把 Project+Documents+AgentLogs 作为 initialProject prop 传入
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
import { summarizeUpdate } from "@/lib/node-summary";
import { DocNav } from "./doc-nav";
import { DocumentView } from "./document-view";
import { AIPanel } from "./ai-panel";
import Link from "next/link";

// ===== 由 server page 传入的初始数据 =====
export interface ProjectDetail {
  id: string;
  name: string;
  description: string;
  status: string; // in_progress | completed
  createdAt: string;
  updatedAt: string;
  documents: {
    id: string;
    type: string;
    title: string;
    status: string; // pending | generating | review | approved
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

// existing 模式从数据库恢复时，优先定位最新的 review 文档；
// pending 仅作为没有 review 文档时的兜底状态。
function getReviewDocument(project: ProjectDetail | null | undefined) {
  if (!project || project.status !== "in_progress") return undefined;
  return (
    project.documents
      .filter((document) => document.status === "review")
      .sort((a, b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))[0] ??
    project.documents.find((document) => document.status === "pending")
  );
}

// 首屏状态直接由服务端传入的数据推导，避免在 effect 中同步 setState。
function getInitialMode(
  initialRequest: string | null | undefined,
  initialProject: ProjectDetail | null | undefined,
): RunMode {
  if (initialRequest) return "running";
  if (!initialProject) return "idle";
  if (initialProject.status === "completed") return "completed";

  return getReviewDocument(initialProject) ? "waiting_review" : "idle";
}

export function WorkspaceShell({ projectId, initialRequest, initialProject }: WorkspaceShellProps) {
  const router = useRouter();
  // ═══════════════════════════════════════════════════════════════════
  //  Hooks 速览（每个 state / ref 是干什么的、为什么这么选）
  //
  //  ■ 判据口诀：会驱动 UI / 会被 JSX 读到 → useState；
  //    只在副作用/事件里做守卫、计数、跨闭包共享、又不想引起重渲染 → useRef。
  //
  //  state —— 都能直接映射到界面：
  //    mode           运行状态机（idle/running/waiting_review/completed/error），驱动全局 UI
  //    projectIdState 当前项目 id（feedback 续跑要带；create 收 done 后写入）
  //    error          错误文案（error 态红条展示）
  //    logs[]         Agent 时间线 = 【单一事实源】：日志流 + 管线状态都由它推导
  //    docs           文档树（type→DocData），DocNav/DocumentView 读取
  //    currentType    当前选中文档 type（决定中间栏渲染哪一篇）
  //    interrupt      暂停信息；非 null = 正等人审阅 → 驱动 ReviewBar 出现
  //
  //  ref —— 不该触发渲染的数据：
  //    busyRef    feedback 请求的防重入锁：async 期间为 true，挡掉双击/连点重复 resume
  //    seqRef     ( + nextSeq() ) 单调递增日志序号：不用时间戳排序（不可靠），
  //               每 push 一条 log 拿一个序号当顺序 & React key，保证顺序稳定
  //    launchedRef create 模式 effect 只应跑一次的标记（下面 launch effect 用）
  // ═══════════════════════════════════════════════════════════════════

  const [mode, setMode] = useState<RunMode>(() => getInitialMode(initialRequest, initialProject));
  const [projectIdState, setProjectId] = useState<string | null>(projectId);
  const [error, setError] = useState<string | null>(null);
  // existing 模式从服务端恢复历史日志和文档；create 模式从空数据开始，等待 SSE 更新。
  const [logs, setLogs] = useState<LogEntry[]>(() => (initialProject ? toLogs(initialProject.agentLogs) : []));
  const [docs, setDocs] = useState<DocMap>(() => (initialProject ? toDocMap(initialProject.documents) : {}));
  // 刷新后没有 interrupt 事件，existing 模式通过数据库文档状态重建审核目标。
  const initialReviewDocument = getReviewDocument(initialProject);
  const [currentType, setCurrentType] = useState<string | null>(
    () => initialReviewDocument?.type ?? initialProject?.documents[0]?.type ?? null,
  );
  const [interrupt, setInterrupt] = useState<InterruptInfo | null>(() =>
    initialReviewDocument
      ? {
          documentType: initialReviewDocument.type ?? null,
          documentTitle: initialReviewDocument.title ?? "文档",
          message: "上次执行在此处暂停，请选择操作继续",
        }
      : null,
  );
  const busyRef = useRef(false); // 防重入锁：详情见上方速览

  const seqRef = useRef(logs.length); // 序号从已有历史日志数续起，避免 key 冲突
  const nextSeq = () => ++seqRef.current;

  // === SSE 事件分发 ===
  const onEvent = useCallback(
    (evt: SSEEvent) => {
      switch (evt.type) {
        case "started": {
          if (evt.projectId && !projectId) {
            setProjectId(evt.projectId);
            if (initialRequest) {
              sessionStorage.setItem(`ai-pm:started:${initialRequest}`, evt.projectId);
            }
            // 只更新地址，不重新挂载组件，避免正在进行的 SSE 被路由切换打断。
            window.history.replaceState(null, "", `/workspace/${evt.projectId}`);
          }
          break;
        }
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
                const summary = summarizeUpdate(evt.node!, data);
                copy[i] = {
                  ...copy[i],
                  status: "done",
                  output: summary ? `${summary.input} → ${summary.output}` : undefined,
                  toolCalls: summary?.toolCalls ?? toolCalls,
                };
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
            // 兼容旧服务端：如果 started 事件因网络抖动丢失，仍在结束时补写 URL。
            setProjectId(evt.projectId);
            if (initialRequest) {
              sessionStorage.setItem(`ai-pm:started:${initialRequest}`, evt.projectId);
            }
            busyRef.current = false;
            window.history.replaceState(null, "", `/workspace/${evt.projectId}`);
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
    [currentType, initialRequest, projectId],
  );

  const { start } = useEventStream({
    onEvent,
    onError: msg => {
      setMode("error");
      setError(msg);
    },
  });

  // === create 模式: 首次渲染自动发起 analyze ===
  // 为什么放 useEffect 而不是直接调用 / 渲染期间调？
  //   1) 它要在浏览器挂载后执行（组件函数体不能有副作用/网络请求）；
  //   2) deps=[initialRequest, start]：start 恒等(useCallback[])，
  //      所以这个 effect 只在挂载后依赖首次变化时触发一次。
  // launchedRef 是「双保险」：React StrictMode 下 dev 会 mount→cleanup→remount，
  // 没有它，首轮 analyze 会被误发第二次（第二次会重复建 Project / 跑一遍图）。
  const launchedRef = useRef(false);
  useEffect(() => {
    if (!initialRequest || launchedRef.current) return; // 无需求（existing 模式）或已发过 → 跳过
    launchedRef.current = true;

    // 浏览器前进/后退或 bfcache 恢复创建页时，回到已有项目，不能重复执行 analyze。
    const existingProjectId = sessionStorage.getItem(`ai-pm:started:${initialRequest}`);
    if (existingProjectId) {
      router.replace(`/workspace/${existingProjectId}`);
      return;
    }

    // 预置第一条 supervisor 日志（active）：让管线第一站立刻"亮起来"，
    // 即使后端第一个 node_start 事件还在路上，UI 也不会空等
    setLogs(l => [...l, { id: `log-${nextSeq()}`, node: "supervisor", status: "active", at: seqRef.current }]);
    start("/api/pm/analyze", { userRequest: initialRequest }); // 建立 SSE 长连接，事件回由 onEvent 分发
  }, [initialRequest, router, start]);

  // existing 模式的审核信息已在初始 state 中根据数据库文档状态恢复。
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

  const projectName = initialProject?.name ?? initialRequest?.slice(0, 20) ?? "AI 产品经理";
  const projectDesc = initialProject?.description ?? initialRequest ?? "";

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-background">
      {/* ==== Header ==== */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border bg-card px-4">
        <Link href="/" className="flex items-center gap-2 text-sm font-semibold tracking-tight">
          <span className="flex size-6 items-center justify-center rounded-md bg-primary text-xs font-bold text-primary-foreground">
            PM
          </span>
          产品工作间
        </Link>
        <span className="text-muted-foreground">/</span>
        <span className="truncate text-sm font-medium">{projectName}</span>
        {projectDesc && (
          <span className="hidden truncate text-xs text-muted-foreground lg:inline">· {projectDesc}</span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <StatusBadge mode={mode} />
          <Link
            href="/"
            className="text-xs text-muted-foreground transition-colors hover:text-foreground"
          >
            新建项目
          </Link>
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
        <aside className="flex w-82.5 shrink-0 flex-col border-l border-border bg-card/40 max-lg:hidden">
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
