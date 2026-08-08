// lib/agent-logs.ts — Agent 执行日志 + 文档持久化
//
// 职责:
//   1. 把 LangGraph stream 的节点输出写入 AgentLog 表（前端"思考过程"面板读取）
//   2. 把生成的文档落库 (Document + Section)，工作台刷新可恢复现场
//
// 数据库全景（见 z-AIPM/doc/m1-tech-decisions.md 决策 6）:
//   - Checkpoint (MemorySaver→PostgresSaver): 图执行状态快照
//   - 业务数据 (Prisma/Neon): Project / Document / Section / AgentLog  ← 本文件
//   - 向量检索 (LanceDB): M2+ 竞品语义搜索

import { prisma } from "./prisma";
import type { AgentDocument } from "@/agent/state";

/** 节点名 → AgentLog 展示信息映射 */
const NODE_META: Record<string, { agentName: string; action: string }> = {
  supervisor: { agentName: "Supervisor", action: "route" },
  research: { agentName: "Research", action: "search" },
  writer: { agentName: "Writer", action: "generate" },
  reviewer: { agentName: "Reviewer", action: "review" },
  human_review: { agentName: "HumanReview", action: "review" },
};

/** 写入一条 AgentLog */
export async function logAgentEvent(
  projectId: string,
  node: string,
  input: string,
  output: string,
  toolCalls?: { tool: string; query: string }[],
) {
  const meta = NODE_META[node] ?? { agentName: node, action: "log" };
  return prisma.agentLog.create({
    data: {
      projectId,
      agentName: meta.agentName,
      action: meta.action,
      input,
      output,
      toolCalls,
    },
  });
}

/** 持久化单个文档 (Document + Section)，存在则整体重建 */
export async function upsertDocument(projectId: string, doc: AgentDocument) {
  // 1. upsert Document 本体
  await prisma.document.upsert({
    where: { projectId_type: { projectId, type: doc.type } },
    update: { title: doc.title, status: doc.status },
    create: { projectId, type: doc.type, title: doc.title, status: doc.status },
  });

  // 2. 找到 documentId
  const document = await prisma.document.findUnique({
    where: { projectId_type: { projectId, type: doc.type } },
  });
  if (!document) return;

  // 3. 章节整体重建（Markdown 内容易变，增量对比成本更高）
  await prisma.section.deleteMany({ where: { documentId: document.id } });
  await prisma.section.createMany({
    data: doc.sections.map((s, i) => ({
      documentId: document.id,
      title: s.title,
      content: s.content,
      order: s.order ?? i,
      status: s.status,
    })),
  });
}

/** 批量持久化多个文档（writer/reviewer/human_review 更新时调用） */
export async function upsertDocuments(projectId: string, docs: Record<string, AgentDocument>) {
  for (const doc of Object.values(docs)) {
    await upsertDocument(projectId, doc);
  }
}
