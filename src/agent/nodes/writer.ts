// agent/nodes/writer.ts — 生成结构化文档章节
// 两种模式: 新生成 / 基于用户反馈增量修改
// 参考: z-AIPM/doc/agent-architecture.md 3.3 Writer Agent

import type { StateType, AgentDocument, DocumentSection } from "../state";
import { generate, hasLLM } from "../llm";

// ===== 文档类型 → 标题映射 =====

const DOC_TITLES: Record<string, string> = {
  prd: "产品需求文档 (PRD)",
  user_persona: "目标用户画像",
  competitor_analysis: "竞品分析报告",
  feature_flow: "核心功能流程",
  roadmap: "开发路线图",
};

// ===== Mock =====

function mockDocument(docType: string, userRequest: string): AgentDocument {
  return {
    type: docType,
    title: DOC_TITLES[docType] || docType,
    sections: [
      {
        title: "1. 概述",
        content: `## 概述\n\n基于用户需求「${userRequest}」生成的结构化分析。\n\n> ⚠️ Mock 模式。配置 DEEPSEEK_API_KEY 后生成真实 AI 内容。`,
        status: "draft", order: 1,
      },
      {
        title: "2. 核心分析",
        content: `## 核心分析\n\n### 目标用户\n面向对 ${userRequest} 有明确需求的用户群体。\n\n### 核心价值主张\n通过 AI 驱动的智能化方案解决痛点。\n\n### 竞争差异化\n在功能深度和用户体验之间找到平衡。`,
        status: "draft", order: 2,
      },
      {
        title: "3. 关键指标",
        content: `## 关键指标\n\n- **日活用户 (DAU)**：目标月均增长 15%\n- **用户留存率**：次日 > 40%，7日 > 20%\n- **核心转化率**：注册→核心功能 > 60%`,
        status: "draft", order: 3,
      },
    ],
    status: "generating",
  };
}

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

  // === 增量修改 ===
  if (state.userFeedback && existing) {
    console.log(`   模式: 增量修改 ("${state.userFeedback}")`);

    const newMarkdown = hasLLM()
      ? await generate(
          "你是产品文档撰写专家。只修改用户反馈相关的部分，其他内容保持完全不变。Markdown 格式。",
          `修改文档「${DOC_TITLES[docType]}」：
用户反馈: "${state.userFeedback}"

当前内容:
${existing.sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n")}`
        )
      : null;

    const markdown = newMarkdown || existing.sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n") +
      `\n\n## 补充内容\n基于反馈「${state.userFeedback}」的补充分析（Mock 模式）。`;

    return {
      documents: { [docType]: { ...existing, sections: parseSections(markdown), status: "review" as const } },
      userFeedback: null,
    };
  }

  // === 新生成 ===
  console.log("   模式: 新生成");

  const markdown = hasLLM()
    ? await generate(
        "你是资深产品文档撰写专家。专业易懂的中文，Markdown 格式。每个章节需要数据支撑。",
        `撰写「${DOC_TITLES[docType]}」。
用户需求: ${state.userRequest}

研究资料:
${state.researchResults.map(r => `### ${r.query}\n${r.summary}`).join("\n\n")}`
      )
    : null;

  const sections = parseSections(markdown || mockDocument(docType, state.userRequest).sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n"));
  console.log(`   生成 ${sections.length} 个章节`);

  return {
    documents: {
      [docType]: { type: docType, title: DOC_TITLES[docType] || docType, sections, status: "review" as const },
    },
  };
}
