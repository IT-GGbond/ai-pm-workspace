// agent/nodes/supervisor.ts — 需求分析 + 任务拆解 + 调度决策
// 参考: z-AIPM/doc/agent-architecture.md 3.1 Supervisor Node

import { v4 as uuid } from "uuid";
import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { StateType, Task } from "../state";
import { createStructuredModel, todayContext } from "../llm";

// ===== Zod Schema: 结构化任务输出 =====
// 传给 model.withStructuredOutput(schema)，LLM 直接返回已校验的对象，无需 JSON.parse

const TaskSchema = z.object({
  tasks: z.array(
    z.object({
      type: z.enum([
        "research",
        "write_prd",
        "write_persona",
        "write_competitor",
        "write_flow",
        "write_roadmap",
      ]),
      description: z.string().describe("中文任务描述"),
      englishQuery: z.string().optional().describe(
        "research 类型任务的英文搜索查询词（10 个词以内）。Tavily 不支持中文。"
      ),
    })
  ).describe("要执行的任务列表"),
});

// ===== 工具函数 =====

function writeTypeToDocType(type: string): string {
  const map: Record<string, string> = {
    write_prd: "prd",
    write_persona: "user_persona",
    write_competitor: "competitor_analysis",
    write_flow: "feature_flow",
    write_roadmap: "roadmap",
  };
  return map[type] || type.replace("write_", "");
}

// ===== 降级任务列表（LLM 不可用时使用，不含虚假竞品数据） =====

function fallbackTasks(): Task[] {
  return [
    { id: uuid(), type: "research", description: "竞品市场调研", englishQuery: "market research competitor analysis", status: "pending" },
    { id: uuid(), type: "write_prd", description: "撰写产品需求文档 (PRD)", status: "pending" },
    { id: uuid(), type: "write_persona", description: "撰写目标用户画像", status: "pending" },
    { id: uuid(), type: "write_competitor", description: "撰写竞品分析报告", status: "pending" },
    { id: uuid(), type: "write_flow", description: "设计核心功能流程", status: "pending" },
    { id: uuid(), type: "write_roadmap", description: "制定开发路线图", status: "pending" },
  ];
}

// ===== 主节点 =====

export async function supervisorNode(state: StateType) {
  console.log("\n🧠 [Supervisor] 分析需求中...");
  console.log(`   用户请求: "${state.userRequest}"`);

  // === 情况 1: 首次进入 → 拆解任务（Zod 结构化输出） ===
  if (state.phase === "planning" || state.tasks.length === 0) {
    console.log("   阶段: 首次任务拆解");

    let tasks: Task[];
    try {
      // === withStructuredOutput — thinking 已通过 modelKwargs 关闭 ===
      const structuredModel = createStructuredModel(TaskSchema);
      if (structuredModel) {
        const parsed = await structuredModel.invoke([
          new SystemMessage(
            `你是资深产品经理。当前日期: ${todayContext()}。分析用户需求，输出结构化任务列表。type: research/write_prd/write_persona/write_competitor/write_flow/write_roadmap。research 任务必须附带 englishQuery——用英文关键词描述搜索内容（10词内），Tavily 搜索引擎不支持中文。关键词中必须使用当前年份。`,
          ),
          new HumanMessage(`用户需求: "${state.userRequest}"`),
        ]);
        tasks = (parsed as z.infer<typeof TaskSchema>).tasks.map(t => ({ ...t, id: uuid(), status: "pending" as const }));
      } else {
        tasks = fallbackTasks();
      }
    } catch (err) {
      console.warn("   任务拆解失败，使用 mock:", (err as Error).message);
      tasks = fallbackTasks();
    }

    console.log(`   拆解出 ${tasks.length} 个任务:`);
    tasks.forEach(t => console.log(`     - [${t.type}] ${t.description}`));

    return {
      tasks,
      phase: "researching" as const,
      nextAgent: "research",
      currentTask: "research",
    };
  }

  // === 情况 2: 研究完成 → 开始写文档 ===
  if (state.phase === "researching") {
    console.log("   阶段: 研究完成 → 调度 Writer");
    return {
      phase: "writing" as const,
      nextAgent: "writer",
      currentTask: "write_prd",
      currentDocument: "prd",
    };
  }

  // === 情况 3: 写作中 → 选择下一个文档 ===
  if (state.phase === "writing") {
    const syncedTasks = state.tasks.map(t => {
      if (!t.type.startsWith("write_")) return t;
      const doc = state.documents[writeTypeToDocType(t.type)];
      if (doc?.status === "approved" && t.status !== "completed") {
        return { ...t, status: "completed" as const };
      }
      return t;
    });

    const pending = syncedTasks.filter(t => t.type.startsWith("write_") && t.status !== "completed");

    if (pending.length === 0) {
      const allApproved = Object.values(state.documents).every(d => d.status === "approved");
      if (allApproved) {
        console.log("   ✅ 全部文档已审批！");
        return { tasks: syncedTasks, phase: "done" as const, nextAgent: null };
      }
      console.log("   所有文档已生成，等待审阅");
      return { tasks: syncedTasks, phase: "reviewing" as const, nextAgent: "reviewer" };
    }

    const next = pending[0];
    const docType = writeTypeToDocType(next.type);
    console.log(`   下一个文档: ${next.type} → ${docType}`);

    return { tasks: syncedTasks, currentDocument: docType, currentTask: next.type, nextAgent: "writer" };
  }

  // === 情况 4: 用户反馈 → 增量修改 ===
  if (state.userFeedback) {
    console.log(`   收到反馈: "${state.userFeedback}"`);
    return { phase: "writing" as const, nextAgent: "writer" };
  }

  // === 情况 5: 审阅阶段 ===
  if (state.phase === "reviewing") {
    const allApproved = Object.values(state.documents).every(d => d.status === "approved");
    if (allApproved) {
      console.log("   ✅ 全部文档审批通过！");
      return { phase: "done" as const, nextAgent: null };
    }
  }

  // === 兜底: phase 异常时尝试恢复 ===
  // 正常流程不会走到这里（所有 case 已覆盖全部 phase 值）
  console.warn(`   ⚠️ [Supervisor] 未预期阶段: phase=${state.phase} feedback=${state.userFeedback ? "有" : "无"} tasks=${state.tasks.length}`);
  if (state.userFeedback) {
    return { phase: "writing" as const, nextAgent: "writer" };
  }
  if (state.tasks.length > 0) {
    // 有任务但 phase 不对 → 恢复为 writing，让调度逻辑接上
    return { phase: "writing" as const, nextAgent: "writer" };
  }
  return { nextAgent: null };
}
