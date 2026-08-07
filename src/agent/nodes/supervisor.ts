// agent/nodes/supervisor.ts — 需求分析 + 任务拆解 + 调度决策
// 参考: z-AIPM/doc/agent-architecture.md 3.1 Supervisor Node

import { v4 as uuid } from "uuid";
import type { Task, AgentDocument } from "../state";
import { generate, hasLLM } from "../llm";

// ===== 工具函数 =====

/** write_xxx → document key 映射 */
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

// ===== Mock 数据 =====

function mockTasks(userRequest: string): Task[] {
  return [
    { id: uuid(), type: "research", description: `搜索 "${userRequest}" 相关竞品和市场数据`, status: "pending" },
    { id: uuid(), type: "write_prd", description: "撰写产品需求文档 (PRD)", status: "pending" },
    { id: uuid(), type: "write_persona", description: "撰写目标用户画像", status: "pending" },
    { id: uuid(), type: "write_competitor", description: "撰写竞品分析报告", status: "pending" },
    { id: uuid(), type: "write_flow", description: "设计核心功能流程", status: "pending" },
    { id: uuid(), type: "write_roadmap", description: "制定开发路线图", status: "pending" },
  ];
}

// ===== 真实 LLM 拆解 =====

async function realTaskDecomposition(userRequest: string): Promise<Task[]> {
  const text = await generate(
    "你是资深产品经理，只返回 JSON。",
    `分析用户需求，拆解为具体可执行任务。返回 JSON: {"tasks": [{"type": "research|write_prd|write_persona|write_competitor|write_flow|write_roadmap", "description": "..."}]}\n\n用户需求: "${userRequest}"`
  );
  if (!text) throw new Error("LLM 返回为空");

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error(`无法解析 JSON: ${text.slice(0, 200)}`);

  const { tasks } = JSON.parse(jsonMatch[0]);
  return tasks.map((t: Omit<Task, "id" | "status">) => ({
    ...t,
    id: uuid(),
    status: "pending" as const,
  }));
}

// ===== 主节点 =====

export async function supervisorNode(state: {
  userRequest: string;
  userFeedback: string | null;
  phase: string;
  tasks: Task[];
  documents: Record<string, AgentDocument>;
  researchResults: unknown[];
  currentDocument: string | null;
}) {
  console.log("\n🧠 [Supervisor] 分析需求中...");
  console.log(`   用户请求: "${state.userRequest}"`);

  // === 情况 1: 首次进入 → 拆解任务 ===
  if (state.phase === "planning" || state.tasks.length === 0) {
    console.log("   阶段: 首次任务拆解");

    let tasks: Task[];
    try {
      tasks = hasLLM() ? await realTaskDecomposition(state.userRequest) : mockTasks(state.userRequest);
    } catch (err) {
      console.warn("   LLM 拆解失败，使用 mock:", err);
      tasks = mockTasks(state.userRequest);
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
    // 将已审批文档对应的 task 标记完成，避免重复选中
    const syncedTasks = state.tasks.map(t => {
      if (!t.type.startsWith("write_")) return t;
      const doc = state.documents[writeTypeToDocType(t.type)];
      if (doc?.status === "approved" && t.status !== "completed") {
        return { ...t, status: "completed" as const };
      }
      return t;
    });

    const pending = syncedTasks.filter(
      t => t.type.startsWith("write_") && t.status !== "completed"
    );

    if (pending.length === 0) {
      const allApproved = Object.values(state.documents).every(
        d => d.status === "approved"
      );
      if (allApproved) {
        console.log("   ✅ 全部文档已审批！");
        return { tasks: syncedTasks, phase: "done" as const, nextAgent: null };
      }
      console.log("   所有文档已生成，等待审阅");
      return {
        tasks: syncedTasks,
        phase: "reviewing" as const,
        nextAgent: "reviewer",
      };
    }

    const next = pending[0];
    const docType = writeTypeToDocType(next.type);
    console.log(`   下一个文档: ${next.type} → ${docType}`);

    return {
      tasks: syncedTasks,
      currentDocument: docType,
      currentTask: next.type,
      nextAgent: "writer",
    };
  }

  // === 情况 4: 用户反馈 → 增量修改 ===
  if (state.userFeedback) {
    console.log(`   收到反馈: "${state.userFeedback}"`);
    return {
      phase: "writing" as const,
      nextAgent: "writer",
    };
  }

  // === 情况 5: 审阅阶段 → 检查是否全部完成 ===
  if (state.phase === "reviewing") {
    const allApproved = Object.values(state.documents).every(
      d => d.status === "approved"
    );
    if (allApproved) {
      console.log("   ✅ 全部文档审批通过！");
      return { phase: "done" as const, nextAgent: null };
    }
  }

  // 默认: 保持当前状态
  return {};
}
