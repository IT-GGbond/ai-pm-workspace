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
          "你是产品文档审查员。宽容务实，只关注严重质量问题（空壳标题、逻辑矛盾、缺核心章节）。不纠结格式/表格/排序/口语化等细节。",
        ),
        new HumanMessage(
          `检查文档「${doc.title}」质量:\n\n${
            doc.sections.map(s => `### ${s.title}\n${s.content.slice(0, 500)}`).join("\n\n")
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
  const maxAttempts = state.maxRewriteAttempts || 3;

  if (result.passed) {
    console.log("   → 提交用户审阅");
    return {
      reviewPassed: true,
      reviewIssues: [],
      rewriteAttempts: 0,
      documents: { [docType]: { ...doc, status: "approved" as const } },
    };
  }

  if (newAttempts >= maxAttempts) {
    console.log(`   → 已达上限 (${maxAttempts}次)，强制人工`);
    return { reviewPassed: false, reviewIssues: result.issues, rewriteAttempts: newAttempts };
  }

  console.log(`   → 退回重写 (${newAttempts}/${maxAttempts})`);
  return { reviewPassed: false, reviewIssues: result.issues, rewriteAttempts: newAttempts };
}
