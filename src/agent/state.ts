// agent/state.ts — Agent 共享状态定义
// 贯穿整个 StateGraph，每个 Node 读取 → 修改 → 写回
// 设计参考: z-AIPM/doc/agent-architecture.md 二、State Schema

import { Annotation } from "@langchain/langgraph";

// ===== 子类型 =====

export interface Task {
  id: string;
  type: "research" | "write_prd" | "write_persona" | "write_competitor" | "write_flow" | "write_roadmap";
  description: string;
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
  tasks: Annotation<Task[]>,
  currentTask: Annotation<string | null>,

  // --- 研究结果 ---
  researchResults: Annotation<ResearchResult[]>,

  // --- 文档内容 ---
  // key: "prd" | "user_persona" | "competitor_analysis" | "feature_flow" | "roadmap"
  documents: Annotation<Record<string, AgentDocument>>,
  currentDocument: Annotation<string | null>,

  // --- 质量控制 ---
  reviewPassed: Annotation<boolean>,
  reviewIssues: Annotation<string[]>,
  rewriteAttempts: Annotation<number>,
  maxRewriteAttempts: Annotation<number>,

  // --- 流程控制 ---
  nextAgent: Annotation<string | null>,
  phase: Annotation<"planning" | "researching" | "writing" | "reviewing" | "done">,
  errors: Annotation<string[]>,
});
