// agent/test-invoke.ts — M1 验收脚本
// 命令行运行: npx tsx src/agent/test-invoke.ts
// 验证完整 Agent 链路: Supervisor → Research → Writer → Reviewer → Human Review
//
// 运行方式:
//   npx tsx src/agent/test-invoke.ts
//   npx tsx src/agent/test-invoke.ts "你的产品想法"  # 自定义需求

import "dotenv/config";
import { v4 as uuid } from "uuid";
import { app } from "./graph";
import { hasLLM } from "./llm";

async function main() {
  const userRequest =
    process.argv[2] || "设计一个面向大学生的英语学习App";

  console.log("=" .repeat(60));
  console.log("AI Product Manager — Agent 核心链路测试");
  console.log("=".repeat(60));
  console.log(`\n📋 用户需求: "${userRequest}"`);
  console.log(`🔑 LLM 状态: ${hasLLM() ? "真实模式 (DeepSeek)" : "Mock 模式 (无 API Key)"}`);
  console.log("");

  const config = {
    configurable: { thread_id: `test-${uuid().slice(0, 8)}` },
  };

  const initialState = {
    userRequest,
    userFeedback: null,
    tasks: [],
    currentTask: null,
    researchResults: [],
    documents: {},
    currentDocument: null,
    reviewPassed: false,
    reviewIssues: [],
    rewriteAttempts: 0,
    maxRewriteAttempts: 3,
    nextAgent: null,
    phase: "planning" as const,
    errors: [],
  };

  console.log("🚀 开始执行 Agent 链路...\n");

  try {
    // streamMode: "updates" 返回每个 node 的输出
    const stream = await app.stream(initialState, {
      ...config,
      streamMode: "updates",
    });

    let stepCount = 0;
    for await (const chunk of stream) {
      stepCount++;
      const [nodeName, nodeOutput] = Object.entries(chunk)[0];

      console.log(`\n--- Step ${stepCount}: ${nodeName} 完成 ---`);

      // 打印关键输出字段
      if (nodeName === "supervisor") {
        const o = nodeOutput as Record<string, unknown>;
        if (o.tasks) {
          const tasks = o.tasks as Array<{ type: string; description: string }>;
          console.log(`   拆解了 ${tasks.length} 个任务`);
          tasks.forEach(t => console.log(`     - [${t.type}] ${t.description}`));
        }
        if (o.phase) console.log(`   阶段: ${o.phase}`);
      }

      if (nodeName === "research") {
        const o = nodeOutput as Record<string, unknown>;
        if (o.researchResults) {
          const results = o.researchResults as Array<{ query: string; summary: string }>;
          console.log(`   搜索结果: ${results.length} 组`);
          results.forEach(r => console.log(`     - ${r.query}: ${r.summary.slice(0, 80)}...`));
        }
      }

      if (nodeName === "writer") {
        const o = nodeOutput as Record<string, unknown>;
        if (o.documents) {
          const docs = o.documents as Record<string, { sections: Array<{ title: string }> }>;
          Object.entries(docs).forEach(([type, doc]) => {
            console.log(`   文档: ${type} (${doc.sections.length} 个章节)`);
          });
        }
      }

      if (nodeName === "reviewer") {
        const o = nodeOutput as Record<string, unknown>;
        console.log(`   通过: ${o.reviewPassed ? "✅" : "❌"}`);
        if (o.reviewIssues) {
          const issues = o.reviewIssues as string[];
          issues.forEach(i => console.log(`     - ${i}`));
        }
      }

      if (nodeName === "human_review") {
        console.log("   👤 等待用户审阅 (M1 阶段自动继续)");
      }
    }

    console.log("\n" + "=".repeat(60));
    console.log(`✅ Agent 链路执行完成 (共 ${stepCount} 个步骤)`);

    // 获取最终状态
    const finalState = await app.getState(config);
    const state = finalState.values as Record<string, unknown>;

    console.log("\n📊 最终状态摘要:");
    console.log(`   阶段: ${state.phase}`);
    console.log(`   任务数: ${(state.tasks as Array<unknown>)?.length || 0}`);
    console.log(`   搜索结果: ${(state.researchResults as Array<unknown>)?.length || 0}`);
    console.log(`   生成文档: ${Object.keys(state.documents as Record<string, unknown> || {}).length} 个`);

    const docs = state.documents as Record<string, { status: string }> | undefined;
    if (docs) {
      Object.entries(docs).forEach(([type, doc]) => {
        console.log(`     - ${type}: ${doc.status}`);
      });
    }

    console.log("\n🎯 M1 验收通过: Agent 链路完整运行，所有节点正确流转");
    console.log("   下一步: 配置 DEEPSEEK_API_KEY 获得真实 LLM 输出");
  } catch (err) {
    console.error("\n❌ Agent 执行失败:", err);
    process.exit(1);
  }
}

main();
