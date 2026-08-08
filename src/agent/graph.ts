// agent/graph.ts — StateGraph 组装 + 条件路由
// 核心编排逻辑，面试时的核心展示文件
// 参考: z-AIPM/doc/agent-architecture.md 四、条件边路由

import { StateGraph, START, END, MemorySaver } from "@langchain/langgraph";
import { ProjectState } from "./state";
import { supervisorNode } from "./nodes/supervisor";
import { researchNode } from "./nodes/research";
import { writerNode } from "./nodes/writer";
import { reviewerNode } from "./nodes/reviewer";
import { humanReviewNode } from "./nodes/human-review";

// ===== 路由函数 =====

/**
 * Supervisor 路由: 决定下一个 Agent
 * 不同 phase 走不同路径:
 *   planning → research
 *   researching → supervisor (回来重新决策)
 *   writing → writer
 *   reviewing → reviewer
 *   done → END
 */
function supervisorRouter(state: typeof ProjectState.State): string {
  const { nextAgent } = state;
  console.log(`   [Router] Supervisor → ${nextAgent || "END"}`);
  if (nextAgent === "research") return "research";
  if (nextAgent === "writer") return "writer";
  if (nextAgent === "reviewer") return "reviewer";
  if (nextAgent === "human") return "human_review";
  return END;
}

/**
 * Reviewer 路由:
 *   通过 → human_review (人工确认)
 *   不通过 + 未超限 → writer (重写)
 *   不通过 + 超限 → human_review (强制人工)
 */
function reviewerRouter(state: typeof ProjectState.State): string {
  const { reviewPassed, rewriteAttempts, maxRewriteAttempts } = state;

  if (reviewPassed) {
    console.log("   [Router] Reviewer → human_review (通过，人工确认)");
    return "human_review";
  }

  if (rewriteAttempts > maxRewriteAttempts) {
    console.log(`   [Router] Reviewer → human_review (已达上限 ${maxRewriteAttempts})`);
    return "human_review";
  }

  console.log(`   [Router] Reviewer → writer (第${rewriteAttempts}次重写)`);
  return "writer";
}

// ===== 图构建 =====

const workflow = new StateGraph(ProjectState)
  // --- 注册节点 ---
  .addNode("supervisor", supervisorNode)
  .addNode("research", researchNode)
  .addNode("writer", writerNode)
  .addNode("reviewer", reviewerNode)
  .addNode("human_review", humanReviewNode)

  // --- 边 ---
  .addEdge(START, "supervisor")

  // Supervisor → Research / Writer / Reviewer / Human / END
  .addConditionalEdges("supervisor", supervisorRouter, [
    "research",
    "writer",
    "reviewer",
    "human_review",
    END,
  ])

  // Research 完成 → 回到 Supervisor 重新决策
  .addEdge("research", "supervisor")

  // Writer → Reviewer
  .addEdge("writer", "reviewer")

  // Reviewer → Writer (重写) / Human (通过或超限)
  .addConditionalEdges("reviewer", reviewerRouter, [
    "writer",
    "human_review",
  ])

  // Human Review → Supervisor (继续后续任务)
  .addEdge("human_review", "supervisor");

// ===== 编译 =====
// MemorySaver: 内存持久化（开发用），后续换 SqliteSaver
const checkpointer = new MemorySaver();

export const app = workflow.compile({ checkpointer });
