// scripts/repro-checkpoint-loss.ts — 复现 Vercel 上 MemorySaver 丢失后的行为
//
// 模拟真实场景:
//   实例 A: analyze 请求 → 运行图 → 在 human_review 暂停 → checkpoint 存在内存里
//   实例 B: feedback 请求 → 同一个 thread_id 但 MemorySaver 是全新的（模拟另一个 serverless 实例）
//
// 预期: 实例 B 找不到 checkpoint → 看看 resume 后会发生什么
//
// 运行: npx tsx scripts/repro-checkpoint-loss.ts

import "dotenv/config";
import { v4 as uuid } from "uuid";
import { Command, StateGraph, START, END, MemorySaver, interrupt } from "@langchain/langgraph";
import { ProjectState, type StateType } from "../src/agent/state";
import { supervisorNode } from "../src/agent/nodes/supervisor";
import { researchNode } from "../src/agent/nodes/research";
import { writerNode } from "../src/agent/nodes/writer";
import { reviewerNode } from "../src/agent/nodes/reviewer";
import { humanReviewNode } from "../src/agent/nodes/human-review";

function supervisorRouter(state: typeof ProjectState.State): string {
  const { nextAgent } = state;
  if (nextAgent === "research") return "research";
  if (nextAgent === "writer") return "writer";
  if (nextAgent === "reviewer") return "reviewer";
  if (nextAgent === "human") return "human_review";
  return END;
}

function reviewerRouter(state: typeof ProjectState.State): string {
  if (state.reviewPassed) return "human_review";
  if (state.rewriteAttempts > state.maxRewriteAttempts) return "human_review";
  return "writer";
}

function buildGraph(checkpointer: MemorySaver) {
  const workflow = new StateGraph(ProjectState)
    .addNode("supervisor", supervisorNode)
    .addNode("research", researchNode)
    .addNode("writer", writerNode)
    .addNode("reviewer", reviewerNode)
    .addNode("human_review", humanReviewNode)
    .addEdge(START, "supervisor")
    .addConditionalEdges("supervisor", supervisorRouter, ["research", "writer", "reviewer", "human_review", END])
    .addEdge("research", "supervisor")
    .addEdge("writer", "reviewer")
    .addConditionalEdges("reviewer", reviewerRouter, ["writer", "human_review"])
    .addEdge("human_review", "supervisor");
  return workflow.compile({ checkpointer });
}

async function runUntilInterrupt(graph: ReturnType<typeof buildGraph>, threadId: string, userRequest: string) {
  let paused = false;
  const stream = await graph.stream(
    { userRequest },
    { configurable: { thread_id: threadId }, streamMode: "updates" },
  );
  for await (const chunk of stream) {
    for (const [node, update] of Object.entries(chunk)) {
      if (node === "__interrupt__") {
        paused = true;
        const payload = (update as Array<{ value?: { documentTitle?: string } }>)[0]?.value;
        console.log(`   ⏸️  实例A 暂停: ${payload?.documentTitle ?? "文档"}`);
      }
    }
  }
  return paused;
}

async function main() {
  const userRequest = "设计一个英语学习App";

  console.log("=".repeat(60));
  console.log("复现: Vercel 上 MemorySaver 丢失后 resume");
  console.log("=".repeat(60));

  // === 实例 A: 分析请求（有完整 checkpoint） ===
  const graphA = buildGraph(new MemorySaver());
  const threadId = `test-${uuid().slice(0, 8)}`;
  console.log(`\n[实例 A] analyze: 运行图并暂停...`);
  const pausedA = await runUntilInterrupt(graphA, threadId, userRequest);
  console.log(`[实例 A] 是否暂停: ${pausedA}`);

  // === 实例 B: feedback 请求（MemorySaver 全新，模拟不同 serverless 实例/冷启动） ===
  const graphB = buildGraph(new MemorySaver());
  console.log(`\n[实例 B] feedback: 用同一个 thread_id=${threadId} resume，但 MemorySaver 是全新的`);
  console.log("    (模拟 Vercel 上 feedback 命中不同实例，checkpoint 已不存在)");

  try {
    const stream = await graphB.stream(
      new Command({ resume: { action: "approve" } }),
      { configurable: { thread_id: threadId }, streamMode: "updates" },
    );

    let paused = false;
    let eventCount = 0;
    for await (const chunk of stream) {
      eventCount++;
      for (const [node, update] of Object.entries(chunk)) {
        if (node === "__interrupt__") {
          paused = true;
          const payload = (update as Array<{ value?: { documentTitle?: string } }>)[0]?.value;
          console.log(`   ⏸️  实例B 暂停: ${payload?.documentTitle ?? "文档"}`);
        } else {
          console.log(`   ▶  ${node}: ${JSON.stringify(update).slice(0, 150)}`);
        }
      }
    }

    console.log(`\n[实例 B] 流事件数: ${eventCount}`);
    console.log(`[实例 B] 结果: ${paused ? "再次暂停（等待审阅）" : "没有暂停 → interrupted=false → 路由会把项目标记为 completed！"}`);

    // === 检查实例 B 的 checkpoint 状态 ===
    const stateB = await graphB.getState({ configurable: { thread_id: threadId } });
    console.log(`[实例 B] checkpoint 状态: phase=${(stateB.values as Record<string, unknown>).phase}, userRequest=${JSON.stringify((stateB.values as Record<string, unknown>).userRequest)}`);
  } catch (err) {
    console.error(`\n[实例 B] ❌ 抛错:`, (err as Error).message);
  }
}

main();
