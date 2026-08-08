// agent/nodes/reviewer.ts — 文档质量自检
// 检查清单 + 重试计数 + 上限路由
// 参考: z-AIPM/doc/agent-architecture.md 3.4 Reviewer Agent

import { z } from "zod";
import type { StateType, AgentDocument } from "../state";
import { generate, hasLLM } from "../llm";

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

  // 执行审查（Zod 结构化输出）
  let result: ReviewResult;
  if (hasLLM()) {
    try {
      const text = await generate(
        "你是严格的产品文档审查员。只返回 JSON，不返回其他内容。",
        `检查文档质量，返回 JSON: {"passed": true/false, "issues": ["问题描述"]}

文档: ${doc.title}
${doc.sections.map(s => `### ${s.title}\n${s.content.slice(0, 500)}`).join("\n\n")}

检查清单:
1. 至少 3 个数据支撑点？
2. 逻辑自洽（无矛盾）？
3. 覆盖必要章节？
4. 语言专业（非口语化）？
5. 每章有实质性内容？`
      );
      if (text) {
        const json = JSON.parse(text.match(/\{[\s\S]*\}/)?.[0] || text);
        result = ReviewResultSchema.parse(json);
      } else {
        result = mockReview(doc);
      }
    } catch (err) {
      console.warn("   审查解析失败，降级 mock:", (err as Error).message);
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
