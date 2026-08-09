// agent/nodes/writer.ts — 生成结构化文档章节
// 两种模式: 新生成 / 基于用户反馈增量修改
// 参考: z-AIPM/doc/agent-architecture.md 3.3 Writer Agent

import type { StateType, AgentDocument, DocumentSection } from "../state";
import { generate, hasLLM, todayContext } from "../llm";

// ===== 文档类型 → 标题映射 =====

const DOC_TITLES: Record<string, string> = {
  prd: "产品需求文档 (PRD)",
  user_persona: "目标用户画像",
  competitor_analysis: "竞品分析报告",
  feature_flow: "核心功能流程",
  roadmap: "开发路线图",
};

// ===== Markdown → Section 解析 =====

function parseSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];
  let order = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      if (currentTitle) {
        order++;
        sections.push({ title: currentTitle, content: currentContent.join("\n").trim(), status: "draft", order });
      }
      currentTitle = line.replace("## ", "").trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  if (currentTitle) {
    order++;
    sections.push({ title: currentTitle, content: currentContent.join("\n").trim(), status: "draft", order });
  }

  if (sections.length === 0 && markdown.trim()) {
    sections.push({ title: "文档内容", content: markdown.trim(), status: "draft", order: 1 });
  }

  return sections;
}

// ===== 主节点 =====

export async function writerNode(state: StateType) {
  const docType = state.currentDocument;
  if (!docType) {
    console.log("✍️ [Writer] 无目标文档，跳过");
    return {};
  }

  console.log(`\n✍️ [Writer] 处理文档: ${docType}`);
  const existing = state.documents[docType];

  // === 增量修改（用户反馈 或 Reviewer 驳回重写）===
  // 防御: existing 不存在时走新生成。此场景出现在状态穿越（如强制人工后
  // 残留 reviewIssues 导致下一篇误判 isRetry），避免读 undefined.sections 崩溃。
  const isRetry = (state.rewriteAttempts > 0 && state.reviewIssues.length > 0) && !!existing;
  if ((state.userFeedback || isRetry) && existing) {
    const feedback = state.userFeedback ?? `Reviewer 驳回:\n${state.reviewIssues.map((s, i) => `${i + 1}. ${s}`).join("\n")}`;
    console.log(`   模式: 增量修改 ("${feedback.slice(0, 60)}...")`);

    const newMarkdown = hasLLM()
      ? await generate(
          `你是产品文档撰写专家。当前日期: ${todayContext()}。根据反馈精确修改文档，只改有问题的部分，其余保持不变。Markdown 格式。`,
          `修改文档「${DOC_TITLES[docType]}」:
反馈: "${feedback}"

当前内容:
${existing.sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n")}`
        )
      : null;

    const markdown = newMarkdown ?? existing.sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n") +
      `\n\n## 补充内容\n基于反馈「${feedback}」的补充分析`;

    return {
      documents: { [docType]: { ...existing, sections: parseSections(markdown), status: "review" as const } },
      userFeedback: null,
    };
  }

  // === 新生成 ===
  console.log("   模式: 新生成");

  const markdown = hasLLM()
    ? await generate(
        `你是资深产品文档撰写专家。当前日期: ${todayContext()}。专业易懂的中文，Markdown 格式。每个章节需要数据支撑。引用数据时注意时效性，过时信息需标注。`,
        `撰写「${DOC_TITLES[docType]}」。
用户需求: ${state.userRequest}

研究资料:
${state.researchResults.map(r => `### ${r.query}\n${r.summary}`).join("\n\n")}`
      )
    : null;

  const sections = parseSections(markdown || "## 需要配置 API Key\n\n当前未配置 LLM API Key（DEEPSEEK_API_KEY 或 ANTHROPIC_API_KEY）。\n\n请在 .env 文件中配置后重试。");
  console.log(`   生成 ${sections.length} 个章节`);

  return {
    documents: {
      [docType]: { type: docType, title: DOC_TITLES[docType] || docType, sections, status: "review" as const },
    },
  };
}
