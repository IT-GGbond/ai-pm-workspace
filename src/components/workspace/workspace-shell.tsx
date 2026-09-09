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

  const [mode, setMode] = useState<RunMode>("idle");
  const [projectIdState, setProjectId] = useState<string | null>(projectId);
  const [error, setError] = useState<string | null>(null);
  // 初值分两种来源：existing 模式由 Server 传入的 initialProject 重建（历史日志→done）
  //                 create 模式为空数组，全靠 SSE 事件实时追加
  const [logs, setLogs] = useState<LogEntry[]>(() => (initialProject ? toLogs(initialProject.agentLogs) : []));
  const [docs, setDocs] = useState<DocMap>(() => (initialProject ? toDocMap(initialProject.documents) : {}));
  const [currentType, setCurrentType] = useState<string | null>(
    () => (initialProject?.documents[0]?.type ?? null),
  );
  const [interrupt, setInterrupt] = useState<InterruptInfo | null>(null);
  const busyRef = useRef(false); // 防重入锁：详情见上方速览

  const seqRef = useRef(logs.length); // 序号从已有历史日志数续起，避免 key 冲突
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
    setMode("running"); // 状态机：idle → running
    // 预置第一条 supervisor 日志（active）：让管线第一站立刻"亮起来"，
    // 即使后端第一个 node_start 事件还在路上，UI 也不会空等
    setLogs(l => [...l, { id: `log-${nextSeq()}`, node: "supervisor", status: "active", at: seqRef.current }]);
    start("/api/pm/analyze", { userRequest: initialRequest }); // 建立 SSE 长连接，事件回由 onEvent 分发
  }, [initialRequest, start]);

  // === existing 模式: 暂停态恢复（刷新后无 interrupt 信息，用 DB 文档状态推断）===
  // 为什么要这个 effect：刷新/直达时页面没有实时 interrupt 事件，
  // 必须靠 initialProject（DB）反推出「上次停在哪篇等人审」，还原成 waiting_review。
  // 完整原理见 docs/frontend-walkthrough.md 第 5.3 节。
  //
  // 本工作流是"逐篇文档 HITL": analyze 首轮只生成第一篇 PRD 就停在 human_review，
  // 其余文档在 DB 中根本不存在（不是 pending，是还没有记录）。
  // 所以不能只看"已存在文档的状态"——
  // 中断点 = 最新一篇状态为 review 的文档（生成完、正等人审阅），而不是：
  //   · approved（那已是审过的，不应再弹一次）
  //   · pending（那可能根本还没生成）
  //   极端兜底才退回 pending。
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
