// lib/agent-runner.ts — 把 LangGraph stream 转成 SSE 事件 + 落库
//
// analyze 和 feedback 两个 API 路由共用此函数，避免重复的流式处理逻辑
// 职责:
//   1. 消费 graph.stream() 的 chunk (streamMode: "updates")
//   2. 转成 node_start / node_output / interrupt SSE 事件
//   3. 节点输出写入 AgentLog 表 + 文档增量持久化
//   4. 返回是否在中途 interrupt 暂停（路由据此决定项目状态）
//
// chunk 格式 (updates mode): { [nodeName]: { 该节点返回的 state 更新 } }
// interrupt 表现: 中断节点输出的 update 里带 __interrupt__ 特殊 key

import { INTERRUPT } from "@langchain/langgraph";
import type { ReadableStreamDefaultController } from "node:stream/web";
import type { AgentDocument } from "@/agent/state";
import { encodeSSE } from "./sse";
import { logAgentEvent, upsertDocuments } from "./agent-logs";

export type SSEController = ReadableStreamDefaultController<Uint8Array>;

/** 单个节点输出的摘要（用于 AgentLog 展示） */
interface NodeSummary {
  input: string;
  output: string;
  toolCalls?: { tool: string; query: string }[];
}

/**
 * 消费 LangGraph stream，边执行边推送 SSE 事件 + 落库
 * @returns { interrupted } 是否在中途 interrupt 暂停
 */
export async function runAgentStream(
  controller: SSEController,
  projectId: string,
  stream: AsyncIterable<Record<string, Record<string, unknown>>>,
): Promise<{ interrupted: boolean }> {
  let interrupted = false;
  const seenNodes = new Set<string>();

  for await (const chunk of stream) {
    for (const [node, update] of Object.entries(chunk)) {
      // === interrupt 检测 ===
      // 观察: updates 模式下 interrupt 以顶层 key 出现 → { __interrupt__: [...] }
      // 防御: 部分版本会嵌套 → { nodeName: { __interrupt__: [...] } }
      if (node === INTERRUPT || (update && typeof update === "object" && INTERRUPT in update)) {
        interrupted = true;
        const payload = getInterruptPayload(update as unknown);
        controller.enqueue(
          encodeSSE({
            type: "interrupt",
            node,
            documentType: payload?.documentType,
            documentTitle: payload?.documentTitle,
            message: payload?.message ?? "文档已生成，请审阅",
          }),
        );
        continue; // 中断标记不是普通输出，跳过落库
      }

      // === 节点开始（首次出现该节点）===
      if (!seenNodes.has(node)) {
        seenNodes.add(node);
        controller.enqueue(encodeSSE({ type: "node_start", node }));
      }

      // === 普通节点输出 ===
      const summary = summarizeUpdate(node, update);
      if (summary) {
        controller.enqueue(encodeSSE({ type: "node_output", node, data: update }));
        await logAgentEvent(projectId, node, summary.input, summary.output, summary.toolCalls);
      }

      // === 文档更新 → 增量持久化 ===
      // writer 生成 / reviewer 标记通过 / human_review 标记审批，都会更新 documents
      const docs = (update as Record<string, unknown>).documents;
      if (docs && typeof docs === "object") {
        await upsertDocuments(projectId, docs as Record<string, AgentDocument>);
      }
    }
  }

  return { interrupted };
}

// ===== 工具函数 =====

/** 取出 interrupt payload（我们传给 interrupt() 的对象） */
function getInterruptPayload(update: unknown): {
  documentType?: string;
  documentTitle?: string;
  message?: string;
} | undefined {
  // 形态 1: { __interrupt__: [{ value: payload }] } → update 本身就是 { __interrupt__: [...] }
  // 形态 2: { nodeName: { __interrupt__: [...] } } → update 是节点输出对象
  const raw = (update as Record<string, unknown>)?.[INTERRUPT] ?? update;
  if (Array.isArray(raw)) {
    return (raw[0] as { value?: { documentType?: string; documentTitle?: string; message?: string } })?.value;
  }
  if (raw && typeof raw === "object") {
    return raw as { documentType?: string; documentTitle?: string; message?: string };
  }
  return undefined;
}

/** 把节点输出转成 AgentLog 摘要 */
function summarizeUpdate(node: string, update: Record<string, unknown>): NodeSummary | null {
  switch (node) {
    case "supervisor": {
      // 区分「拆解任务」(首次 planning) 与「同步进度」(writing 阶段每次调度)
      if (Array.isArray(update.tasks)) {
        // phase 被设置 = 首次拆解（case 1: planning → researching）
        if (update.phase) {
          return { input: "分析用户需求", output: `拆解 ${update.tasks.length} 个任务` };
        }
        // 否则是 writing 阶段的进度同步（case 3），不叫"拆解"
        const doneCount = (update.tasks as Array<{ status?: string }>).filter(
          (t) => t.status === "completed",
        ).length;
        const nextDoc = typeof update.currentDocument === "string" ? update.currentDocument : "";
        return { input: "调度决策", output: `→ ${nextDoc || "同步进度"} (${doneCount}/${update.tasks.length} 完成)` };
      }
      if (update.nextAgent) {
        return { input: "调度决策", output: `下一步 → ${String(update.nextAgent)}` };
      }
      return null;
    }

    case "research": {
      const results = (Array.isArray(update.researchResults) ? update.researchResults : []) as Array<{
        query: string;
        sources: unknown[];
      }>;
      return {
        input: "竞品搜索",
        output: results.map(r => `「${r.query}」→ ${r.sources.length} 条结果`).join("；"),
        toolCalls: results.map(r => ({ tool: "tavily_search", query: r.query })),
      };
    }

    case "writer": {
      const docs = (update.documents ?? {}) as Record<string, AgentDocument>;
      const list = Object.values(docs);
      return {
        input: "撰写文档",
        output: list.map(d => `「${d.title}」生成 ${d.sections.length} 个章节`).join("；"),
      };
    }

    case "reviewer": {
      const issues = (Array.isArray(update.reviewIssues) ? update.reviewIssues : []) as string[];
      return {
        input: "质量审查",
        output: update.reviewPassed ? "✅ 审查通过" : `❌ ${issues.length} 个问题`,
      };
    }

    case "human_review":
      return null; // interrupt 已单独处理，不会走到这里

    default:
      return { input: node, output: JSON.stringify(update).slice(0, 200) };
  }
}
