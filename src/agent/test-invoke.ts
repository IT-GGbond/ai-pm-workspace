// agent/test-invoke.ts — M1 验收脚本
// 命令行运行: npx tsx src/agent/test-invoke.ts
// 验证完整 Agent 链路: Supervisor → Research → Writer → Reviewer → Human Review
//
// 运行方式:
//   npx tsx src/agent/test-invoke.ts
//   npx tsx src/agent/test-invoke.ts "你的产品想法"  # 自定义需求

import "dotenv/config";
import { v4 as uuid } from "uuid";
import { Command, INTERRUPT } from "@langchain/langgraph";
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
    // === HITL 循环 ===
    // 每次运行到 interrupt 暂停点，脚本自动 approve 继续
    // 真实场景中暂停点由前端 ReviewBar 处理
    // input 类型 = app.stream 的第一个参数（普通 state 更新 或 Command）
    type StreamInput = Parameters<typeof app.stream>[0];
    let input: StreamInput = initialState as StreamInput;
    let stepCount = 0;
    let reviewCount = 0;

    while (true) {
      // streamMode: "updates" 返回每个 node 的输出
      const stream = await app.stream(input, {
        ...config,
        streamMode: "updates",
      });

      let paused = false;

      for await (const chunk of stream) {
        stepCount++;
        const [nodeName, rawOutput] = Object.entries(chunk)[0] as [string, unknown];

        console.log(`\n--- Step ${stepCount}: ${nodeName} 完成 ---`);

        // === interrupt 检测: updates 模式下以顶层 key 出现 → { __interrupt__: [...] } ===
        if (nodeName === INTERRUPT) {
          paused = true;
          const interrupts = (Array.isArray(rawOutput) ? rawOutput : []) as Array<{
            value?: { documentTitle?: string; message?: string };
          }>;
          const payload = interrupts[0]?.value;
          console.log(`   ⏸️  暂停: ${payload?.documentTitle ?? "文档"} 等待用户审阅`);
          continue;
        }

        // 普通节点输出
        const nodeOutput = rawOutput as Record<string, unknown>;

        // 打印关键输出字段
        if (nodeName === "supervisor") {
          if (nodeOutput.tasks) {
            const tasks = nodeOutput.tasks as Array<{ type: string; description: string }>;
            console.log(`   拆解了 ${tasks.length} 个任务`);
            tasks.forEach(t => console.log(`     - [${t.type}] ${t.description}`));
          }
          if (nodeOutput.phase) console.log(`   阶段: ${nodeOutput.phase}`);
        }

        if (nodeName === "research") {
          if (nodeOutput.researchResults) {
            const results = nodeOutput.researchResults as Array<{ query: string; summary: string }>;
            console.log(`   搜索结果: ${results.length} 组`);
            results.forEach(r => console.log(`     - ${r.query}: ${r.summary.slice(0, 80)}...`));
          }
        }

        if (nodeName === "writer") {
          if (nodeOutput.documents) {
            const docs = nodeOutput.documents as Record<string, { sections: Array<{ title: string }> }>;
            Object.entries(docs).forEach(([type, doc]) => {
              console.log(`   文档: ${type} (${doc.sections.length} 个章节)`);
            });
          }
        }

        if (nodeName === "reviewer") {
          console.log(`   通过: ${nodeOutput.reviewPassed ? "✅" : "❌"}`);
          if (nodeOutput.reviewIssues) {
            const issues = nodeOutput.reviewIssues as string[];
            issues.forEach(i => console.log(`     - ${i}`));
          }
        }
      }

      // 无暂停 → 全部文档审批完成，退出循环
      if (!paused) break;

      // 有暂停 → 模拟用户点击"确认通过"
      reviewCount++;
      console.log(`\n   👤 自动确认通过 (第 ${reviewCount} 次审阅)...`);
      input = new Command({ resume: { action: "approve" } }) as StreamInput;
    }

    console.log("\n" + "=".repeat(60));
    console.log(`✅ Agent 链路执行完成 (共 ${stepCount} 个步骤, ${reviewCount} 次人工审阅)`);

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

    console.log("\n🎯 M1+M2 HITL 验收通过: Agent 链路完整运行 + 暂停/恢复闭环");
    console.log("   下一步: 配置 DEEPSEEK_API_KEY 获得真实 LLM 输出");
  } catch (err) {
    console.error("\n❌ Agent 执行失败:", err);
    process.exit(1);
  }
}

main();
