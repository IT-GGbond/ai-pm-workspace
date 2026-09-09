import type { AgentDocument } from "@/agent/state";

export interface NodeSummary {
  input: string;
  output: string;
  toolCalls?: { tool: string; query: string }[];
}

/** 把节点输出转成 AgentLog 和前端时间线共用的摘要。 */
export function summarizeUpdate(node: string, update: Record<string, unknown>): NodeSummary | null {
  switch (node) {
    case "supervisor": {
      if (Array.isArray(update.tasks)) {
        if (update.phase) {
          return { input: "分析用户需求", output: `拆解 ${update.tasks.length} 个任务` };
        }
        const doneCount = (update.tasks as Array<{ status?: string }>).filter(
          (task) => task.status === "completed",
        ).length;
        const nextDoc = typeof update.currentDocument === "string" ? update.currentDocument : "";
        return {
          input: "调度决策",
          output: `→ ${nextDoc || "同步进度"} (${doneCount}/${update.tasks.length} 完成)`,
        };
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
        output: results.map((result) => `「${result.query}」→ ${result.sources.length} 条结果`).join("；"),
        toolCalls: results.map((result) => ({ tool: "tavily_search", query: result.query })),
      };
    }

    case "writer": {
      const docs = (update.documents ?? {}) as Record<string, AgentDocument>;
      return {
        input: "撰写文档",
        output: Object.values(docs)
          .map((doc) => `「${doc.title}」生成 ${doc.sections.length} 个章节`)
          .join("；"),
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
      return null;

    default:
      return { input: node, output: JSON.stringify(update).slice(0, 200) };
  }
}
