// agent/state.ts — Agent 共享状态定义
// 贯穿整个 StateGraph，每个 Node 读取 → 修改 → 写回
// 设计参考: z-AIPM/doc/agent-architecture.md 二、State Schema
//
// LangGraph 1.x 状态定义要点:
//   - Annotation.Root({...}) 等价 Python 的 TypedDict + Annotated
//   - 每个字段可指定 reducer（默认: 直接覆盖）
//   - 导出 StateType = typeof ProjectState.State 供所有 Node 用

import { Annotation } from "@langchain/langgraph";

// ===== 子类型 =====

export interface Task {
  id: string;
  type: "research" | "write_prd" | "write_persona" | "write_competitor" | "write_flow" | "write_roadmap";
  description: string; // 中文任务描述（展示用）
  englishQuery?: string; // 英文搜索关键词（research 任务用，省去一次 LLM 翻译调用）
  status: "pending" | "in_progress" | "completed";
}

export interface ResearchSource {
  title: string;
  url: string;
  snippet: string;
}

export interface ResearchResult {
  query: string;
  sources: ResearchSource[];
  summary: string;
}

export interface DocumentSection {
  title: string;
  content: string;    // Markdown
  status: "draft" | "review" | "approved";
  order: number;
}

export interface AgentDocument {
  type: string;
  title: string;
  sections: DocumentSection[];
  status: "pending" | "generating" | "review" | "approved";
}

// ===== ProjectState =====

export const ProjectState = Annotation.Root({
  // --- 用户输入 ---
  userRequest: Annotation<string>,
  userFeedback: Annotation<string | null>,

  // --- 任务规划 ---
  // reducer: 每次 Supervisor 返回新的任务列表时完全替换
  tasks: Annotation<Task[]>({
    reducer: (_, replacement) => replacement,
    default: () => [],
  }),
  currentTask: Annotation<string | null>,

  // --- 研究结果 ---
  // reducer: Research 节点追加新结果到已有列表
  researchResults: Annotation<ResearchResult[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),

  // --- 文档内容 ---
  // key: "prd" | "user_persona" | "competitor_analysis" | "feature_flow" | "roadmap"
  documents: Annotation<Record<string, AgentDocument>>({
    reducer: (current, update) => ({ ...current, ...update }),
    default: () => ({}),
  }),
  currentDocument: Annotation<string | null>,

  // --- 质量控制 ---
  reviewPassed: Annotation<boolean>,
  // reducer: Reviewer 替换整个问题列表
  reviewIssues: Annotation<string[]>({
    reducer: (_, replacement) => replacement,
    default: () => [],
  }),
  rewriteAttempts: Annotation<number>({
    reducer: (_, x) => x,
    default: () => 0,
  }),
  maxRewriteAttempts: Annotation<number>({
    reducer: (_, x) => x,
    // 重试上限 1: 每次驳回重写都要 Writer 整篇重写 + Reviewer 全文重审，token 消耗大。
    // 只给 1 次自动重试，仍不通过就强制人工（人工可再 iterate，体验反而更好）
    default: () => 1,
  }),

  // --- 流程控制 ---
  nextAgent: Annotation<string | null>,
  phase: Annotation<"planning" | "researching" | "writing" | "reviewing" | "done">,
  // reducer: 各节点追加错误信息
  errors: Annotation<string[]>({
    reducer: (current, update) => [...current, ...update],
    default: () => [],
  }),
});

/** 全局 State 类型 — 所有 Node 参数统一用此类型 */
export type StateType = typeof ProjectState.State;
