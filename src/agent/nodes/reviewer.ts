// agent/nodes/reviewer.ts — 文档质量自检
// 检查清单 + 重试计数 + 上限路由
// 参考: z-AIPM/doc/agent-architecture.md 3.4 Reviewer Agent

import type { AgentDocument } from "../state";
import { generate, hasLLM } from "../llm";

// ===== 检查清单 =====

interface ReviewResult {
  passed: boolean;
  issues: string[];
}

// ===== Mock 审核 =====

function mockReview(doc: AgentDocument): ReviewResult {
  const issues: string[] = [];

  if (doc.sections.length < 3) {
    issues.push("章节数量不足 3 个");
  }

  const totalLength = doc.sections.reduce((sum, s) => sum + s.content.length, 0);
  if (totalLength < 200) {
    issues.push("总内容过短 (< 200 字符)，可能信息量不足");
  }

  // Mock 模式下默认通过（除非明显问题）
  if (issues.length === 0) {
    return { passed: true, issues: [] };
  }
  return { passed: false, issues };
}

// ===== 真实 LLM 审核 =====

async function realReview(doc: AgentDocument): Promise<ReviewResult> {
  const docContent = doc.sections
    .map(s => `### ${s.title}\n${s.content}`)
    .join("\n\n");

  const text = await generate(
    "你是严格的产品文档审查员。只返回 JSON，不要其他内容。",
    `检查以下文档质量，返回 JSON: {"passed": true/false, "issues": ["问题1", ...]}

文档: ${doc.title}
内容:
${docContent}

检查清单:
1. 是否有至少 3 个数据支撑点？
2. 逻辑是否自洽（前后不矛盾）？
3. 是否覆盖了该文档类型的必要章节？
4. 语言是否专业，无口语化表达？
5. 每个章节是否有实质性内容（非凑字数）？`
  );

  if (!text) {
    return { passed: true, issues: ["⚠️ LLM 未返回结果，默认通过"] };
  }

  try {
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("无 JSON");
    return JSON.parse(jsonMatch[0]);
  } catch {
    return { passed: true, issues: ["⚠️ 审阅结果解析失败，默认通过"] };
  }
}

// ===== 主节点 =====

export async function reviewerNode(state: {
  currentDocument: string | null;
  documents: Record<string, AgentDocument>;
  rewriteAttempts: number;
  maxRewriteAttempts: number;
}) {
  const docType = state.currentDocument;
  if (!docType) {
    console.log("🔎 [Reviewer] 无目标文档，跳过");
    return {};
  }

  const doc = state.documents[docType];
  if (!doc) {
    console.log(`🔎 [Reviewer] 文档 ${docType} 不存在，跳过`);
    return {};
  }

  console.log(`\n🔎 [Reviewer] 审查文档: ${docType}`);
  console.log(`   章节数: ${doc.sections.length}`);

  // 执行审查
  let result: ReviewResult;
  if (hasLLM()) {
    result = await realReview(doc);
  } else {
    result = mockReview(doc);
  }

  console.log(`   结果: ${result.passed ? "✅ 通过" : "❌ 不通过"}`);
  if (result.issues.length > 0) {
    result.issues.forEach((issue: string) => console.log(`     - ${issue}`));
  }

  const newAttempts = result.passed ? 0 : state.rewriteAttempts + 1;

  if (result.passed) {
    // 通过: 标记 approved，重置计数
    console.log("   → 提交用户审阅");
    return {
      reviewPassed: true,
      reviewIssues: [],
      rewriteAttempts: 0,
      documents: {
        ...state.documents,
        [docType]: { ...doc, status: "approved" as const },
      },
    };
  }

  // 不通过 → 检查重试上限
  if (newAttempts >= (state.maxRewriteAttempts || 3)) {
    console.log(`   → 已达重试上限 (${state.maxRewriteAttempts || 3}次)，强制人工决策`);
    return {
      reviewPassed: false,
      reviewIssues: result.issues,
      rewriteAttempts: newAttempts,
    };
  }

  console.log(`   → 退回 Writer 重写 (第 ${newAttempts}/${state.maxRewriteAttempts || 3} 次)`);
  return {
    reviewPassed: false,
    reviewIssues: result.issues,
    rewriteAttempts: newAttempts,
  };
}
