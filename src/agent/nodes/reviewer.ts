// agent/nodes/reviewer.ts — 文档质量自检
// 检查清单 + 重试计数 + 上限路由
// 参考: z-AIPM/doc/agent-architecture.md 3.4 Reviewer Agent

import { z } from "zod";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { StateType, AgentDocument } from "../state";
import { createStructuredModel } from "../llm";

// ===== Zod Schema: 结构化审查结果 =====

const ReviewResultSchema = z.object({
  passed: z.boolean().describe("是否通过审查"),
  issues: z.array(z.string()).describe("不通过的原因列表，通过时为空数组"),
});

type ReviewResult = z.infer<typeof ReviewResultSchema>;

// ===== Mock 审查 =====

function mockReview(doc: AgentDocument): ReviewResult {
  const issues: string[] = [];

  if (doc.sections.length < 3) {
    issues.push("章节数量不足 3 个");
  }

  const totalLength = doc.sections.reduce((sum, s) => sum + s.content.length, 0);
  if (totalLength < 200) {
    issues.push("总内容过短 (< 200 字符)");
  }

  return { passed: issues.length === 0, issues };
}

// ===== 主节点 =====

export async function reviewerNode(state: StateType) {
  const docType = state.currentDocument;
  if (!docType || !state.documents[docType]) {
    console.log(`🔎 [Reviewer] 无文档，跳过`);
    return {};
  }

  const doc = state.documents[docType];
  console.log(`\n🔎 [Reviewer] 审查: ${docType} (${doc.sections.length} 章节)`);

  // 执行审查（withStructuredOutput — thinking 已通过 modelKwargs 关闭）
  let result: ReviewResult;
  const structuredModel = createStructuredModel(ReviewResultSchema);
  if (structuredModel) {
    try {
      const parsed = await structuredModel.invoke([
        new SystemMessage(
          "你是产品文档审查员。默认通过，只有存在严重缺陷（空壳标题、核心章节缺失、关键数据自相矛盾）才驳回。宁可放过小的不完美，也不要因为细节反复重写——重写消耗大量 token。",
        ),
        new HumanMessage(
          `检查文档「${doc.title}」质量:\n\n${
            doc.sections.map(s => `### ${s.title}\n${s.content.slice(0, 300)}`).join("\n\n")
          }`,
        ),
      ]);
      result = parsed as ReviewResult;
    } catch (err) {
      console.warn("   审查失败，降级 mock:", (err as Error).message);
      result = mockReview(doc);
    }
  } else {
    result = mockReview(doc);
  }

  console.log(`   结果: ${result.passed ? "✅ 通过" : "❌ 不通过"}`);
  result.issues.forEach(i => console.log(`     - ${i}`));

  const newAttempts = result.passed ? 0 : state.rewriteAttempts + 1;
  // 默认 1（state.ts 定义）: 一次自动重试，仍不通过就强制人工审阅
  const maxAttempts = state.maxRewriteAttempts || 1;

  if (result.passed) {
    console.log("   → 提交用户审阅");
    return {
      reviewPassed: true,
      reviewIssues: [],
      rewriteAttempts: 0,
      // 注意: 这里不能把文档标成 approved —— 审批权在 human_review 节点。
      // 若在此标 approved，DB 里文档在人工审阅前就变成"已通过"，
      // 前端 router.replace 到 /workspace/:id 按 DB 恢复现场时找不到 review 态文档
      // → 审核栏消失、页面卡死（bug: reviewer 抢了人工审批的标记）。
      // 保持 review 态，等用户在 human_review 点"确认通过"再置 approved。
      documents: { [docType]: { ...doc, status: "review" as const } },
    };
  }

  if (newAttempts >= maxAttempts) {
    console.log(`   → 已达上限 (${maxAttempts}次)，强制人工`);
    return { reviewPassed: false, reviewIssues: result.issues, rewriteAttempts: newAttempts };
  }

  console.log(`   → 退回重写 (${newAttempts}/${maxAttempts})`);
  return { reviewPassed: false, reviewIssues: result.issues, rewriteAttempts: newAttempts };
}
