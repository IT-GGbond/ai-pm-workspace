// agent/nodes/human-review.ts — 人工审阅节点 (Human-in-the-Loop)
//
// 核心: interrupt() 暂停图执行，等待用户审阅
//   - 第一次执行到这里 → 抛出 GraphInterrupt，图暂停
//     (中断信息通过 __interrupt__ 暴露给调用方 / SSE 事件)
//   - 用户在前端决策 → POST /api/pm/feedback → Command({ resume }) 恢复
//     → interrupt() 返回用户决策，节点继续执行
//
// 文档参考: https://docs.langchain.com/oss/javascript/langgraph/interrupts
// 参考: z-AIPM/doc/agent-architecture.md 3.5 Human Review

import { interrupt } from "@langchain/langgraph";
import type { StateType } from "../state";

/** 用户在审阅界面做出的决策（interrupt 恢复时的返回值） */
export interface ReviewAction {
  /** approve=确认通过 | modify=补充意见(增量改) | rewrite=重写 */
  action: "approve" | "modify" | "rewrite";
  feedback?: string; // modify/rewrite 时用户的具体意见
}

/** 暂停时传给前端展示的 payload（出现在 __interrupt__ 里） */
interface ReviewPayload {
  type: "document_review";
  documentType: string | null;
  documentTitle?: string;
  message: string;
}

export async function humanReviewNode(state: StateType) {
  const docType = state.currentDocument;
  const doc = docType ? state.documents[docType] : null;

  // 1. 暂停: interrupt 的 payload 会传给前端展示（文档标题 + 提示语）
  //    恢复后此调用返回用户决策 (ReviewAction)
  const answer = interrupt<ReviewPayload, ReviewAction>({
    type: "document_review",
    documentType: docType,
    documentTitle: doc?.title,
    message: doc ? `文档「${doc.title}」已生成，请审阅` : "请审阅",
  });

  // 2. 恢复执行: answer = { action, feedback }
  const action = answer?.action ?? "modify";
  const feedback = answer?.feedback?.trim() || undefined;

  if (!docType || !doc) {
    return { nextAgent: "supervisor", reviewPassed: false };
  }

  // === 确认通过 → 标记 approved，Supervisor 自动调度下一个文档 ===
  if (action === "approve") {
    console.log(`   👤 用户确认通过: ${doc.title}`);
    return {
      documents: { [docType]: { ...doc, status: "approved" as const } },
      reviewPassed: true,
      // 重置质量计数: 上一篇文档的 reviewer 驳回信息不能泄漏到下一篇，
      // 否则 writer 会误判 isRetry 并尝试读一个尚未生成的文档而崩溃
      reviewIssues: [],
      rewriteAttempts: 0,
      userFeedback: null,
      nextAgent: "supervisor",
    };
  }

  // === 补充意见 / 重写 → 带着反馈回到 Writer 增量修改 ===
  console.log(`   👤 用户反馈 (${action}): "${feedback ?? "（无具体意见）"}"`);
  return {
    documents: { [docType]: { ...doc, status: "generating" as const } },
    reviewPassed: false,
    userFeedback: feedback ?? `请根据审阅意见重新修改「${doc.title}」`,
    nextAgent: "supervisor",
  };
}
