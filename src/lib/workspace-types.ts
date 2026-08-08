// lib/workspace-types.ts — 前端工作台共享类型
//
// 服务端 SSE 事件 + Prisma 数据 → 前端可消费的结构化类型
// 与 src/lib/sse.ts 的 SSEEvent 对齐（前端 type-only import，零运行时成本）

import type { SSEEvent } from "./sse";

export type { SSEEvent };

// ===== 文档（对应 DB Document + Section，前端渲染用）=====
export interface SectionData {
  title: string;
  content: string; // Markdown
  order: number;
  status: string; // draft | review | approved
}

export interface DocData {
  type: string; // prd | user_persona | competitor_analysis | feature_flow | roadmap
  title: string;
  status: string; // pending | generating | review | approved
  sections: SectionData[];
}

export type DocMap = Record<string, DocData>;

// ===== Agent 时间线（右侧 AIPanel 展示）=====
export interface LogEntry {
  id: string; // node + 序号，React key
  node: string; // supervisor | research | writer | reviewer | human_review
  status: "active" | "done" | "waiting" | "error";
  output?: string; // 节点输出的可读摘要
  toolCalls?: { tool: string; query: string }[];
  at: number; // 递增序号，控制列表顺序
}

// ===== HITL 审阅信息（ReviewBar 展示）=====
export interface InterruptInfo {
  documentType: string | null;
  documentTitle: string;
  message: string;
}

// ===== 首页项目列表项（对应 GET /api/pm/projects）=====
export interface ProjectSummary {
  id: string;
  name: string;
  description: string;
  status: string; // in_progress | completed
  updatedAt: string;
  _count: { documents: number };
}

/** 5 种文档类型的元信息（DocNav 用） */
export const DOC_TYPES: { type: string; label: string; desc: string }[] = [
  { type: "prd", label: "PRD 产品需求文档", desc: "产品定位 · 目标用户 · 功能 · 指标" },
  { type: "user_persona", label: "用户画像", desc: "目标人群 · 场景 · 痛点" },
  { type: "competitor_analysis", label: "竞品分析", desc: "竞品对比 · 差异化机会" },
  { type: "feature_flow", label: "功能流程", desc: "核心功能 · 用户路径" },
  { type: "roadmap", label: "开发路线图", desc: "里程碑 · 迭代规划" },
];

/** 文档状态 → 徽章文案 */
export const DOC_STATUS_LABEL: Record<string, string> = {
  pending: "待生成",
  generating: "生成中",
  review: "待审阅",
  approved: "已通过",
};

/** 工作台运行模式（header 徽章 + 面板状态 UI 共用） */
export type RunMode = "idle" | "running" | "waiting_review" | "completed" | "error";

/** Agent 节点顺序（管线展示固定顺序） */
export const AGENT_ORDER = ["supervisor", "research", "writer", "reviewer", "human_review"] as const;

export const AGENT_LABEL: Record<string, string> = {
  supervisor: "需求拆解",
  research: "竞品调研",
  writer: "文档撰写",
  reviewer: "质量审查",
  human_review: "人工审阅",
};
