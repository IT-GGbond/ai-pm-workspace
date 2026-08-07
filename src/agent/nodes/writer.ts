// agent/nodes/writer.ts — 根据研究结果生成结构化文档章节
// 支持两种模式: 新生成 / 基于用户反馈增量修改
// 参考: z-AIPM/doc/agent-architecture.md 3.3 Writer Agent

import type { AgentDocument, DocumentSection, ResearchResult } from "../state";
import { generate, hasLLM } from "../llm";

// ===== 文档类型 → 标题映射 =====

const DOC_TITLES: Record<string, string> = {
  prd: "产品需求文档 (PRD)",
  user_persona: "目标用户画像",
  competitor_analysis: "竞品分析报告",
  feature_flow: "核心功能流程",
  roadmap: "开发路线图",
};

// ===== Mock 文档生成 =====

function mockDocument(docType: string, userRequest: string): AgentDocument {
  const sections: DocumentSection[] = [
    {
      title: "1. 概述",
      content: `## 概述\n\n本文档基于用户需求「${userRequest}」生成，提供结构化的产品分析。\n\n> ⚠️ 当前为 Mock 模式（未配置 LLM API Key），展示的是示例内容。配置 DEEPSEEK_API_KEY 后将生成真实 AI 内容。`,
      status: "draft",
      order: 1,
    },
    {
      title: "2. 核心分析",
      content: `## 核心分析\n\n### 目标用户\n产品面向的核心用户群体为对 ${userRequest} 有明确需求的用户。\n\n### 核心价值主张\n通过 AI 驱动的智能化方案，解决用户的痛点问题。\n\n### 竞争差异化\n在功能深度和用户体验之间找到平衡，建立护城河。`,
      status: "draft",
      order: 2,
    },
    {
      title: "3. 关键指标",
      content: `## 关键指标\n\n- **日活用户 (DAU)**：目标月均增长 15%\n- **用户留存率**：次日留存 > 40%，7 日留存 > 20%\n- **核心转化率**：从注册到核心功能使用的转化 > 60%`,
      status: "draft",
      order: 3,
    },
  ];

  return {
    type: docType,
    title: DOC_TITLES[docType] || docType,
    sections,
    status: "generating",
  };
}

// ===== 真实 LLM 生成 =====

async function realGenerate(
  docType: string,
  userRequest: string,
  researchResults: ResearchResult[],
): Promise<string> {
  const researchContext = researchResults
    .map(r => `### ${r.query}\n${r.summary}`)
    .join("\n\n");

  return (await generate(
    "你是资深产品文档撰写专家。用专业但易懂的中文，Markdown 格式输出。每个章节需要数据支撑。",
    `基于以下信息，撰写「${DOC_TITLES[docType]}」文档。

用户需求: ${userRequest}

研究资料:
${researchContext}

输出标准 Markdown 格式，包含多个章节（使用 ## 标题）。
每个章节需要有实质性内容，引用研究资料中的数据。`
  )) || "";
}

async function realModify(
  docType: string,
  existingSections: DocumentSection[],
  feedback: string,
): Promise<string> {
  return (await generate(
    "你是产品文档撰写专家。只修改用户要求的章节，其他内容保持完全不变。",
    `修改以下文档的特定章节。

文档类型: ${DOC_TITLES[docType]}
用户反馈: "${feedback}"

当前文档内容:
${existingSections.map(s => `### ${s.title}\n${s.content}`).join("\n\n")}

只修改与用户反馈相关的部分，其他章节原样保留。用 Markdown 格式输出完整文档。`
  )) || "";
}

// ===== 解析 LLM 输出为 Section 数组 =====

function parseSections(markdown: string): DocumentSection[] {
  const sections: DocumentSection[] = [];
  const lines = markdown.split("\n");
  let currentTitle = "";
  let currentContent: string[] = [];
  let order = 0;

  for (const line of lines) {
    if (line.startsWith("## ")) {
      // 保存上一个 section
      if (currentTitle) {
        order++;
        sections.push({
          title: currentTitle,
          content: currentContent.join("\n").trim(),
          status: "draft",
          order,
        });
      }
      currentTitle = line.replace("## ", "").trim();
      currentContent = [];
    } else {
      currentContent.push(line);
    }
  }

  // 最后一个
  if (currentTitle) {
    order++;
    sections.push({
      title: currentTitle,
      content: currentContent.join("\n").trim(),
      status: "draft",
      order,
    });
  }

  // 如果没解析出任何 section，整个内容作为一个
  if (sections.length === 0 && markdown.trim()) {
    sections.push({
      title: "文档内容",
      content: markdown.trim(),
      status: "draft",
      order: 1,
    });
  }

  return sections;
}

// ===== 主节点 =====

export async function writerNode(state: {
  userRequest: string;
  currentDocument: string | null;
  researchResults: ResearchResult[];
  documents: Record<string, AgentDocument>;
  userFeedback: string | null;
  tasks: { type: string; status: string }[];
}) {
  const docType = state.currentDocument;
  if (!docType) {
    console.log("✍️ [Writer] 无目标文档，跳过");
    return {};
  }

  console.log(`\n✍️ [Writer] 处理文档: ${docType}`);

  const existing = state.documents[docType];

  // === 情况 1: 用户反馈 → 增量修改 ===
  if (state.userFeedback && existing) {
    console.log(`   模式: 增量修改 (反馈: "${state.userFeedback}")`);

    let newMarkdown: string;
    if (hasLLM()) {
      newMarkdown = await realModify(docType, existing.sections, state.userFeedback);
    } else {
      // Mock 增量修改: 在现有内容后追加反馈标记
      newMarkdown = existing.sections
        .map(s => `## ${s.title}\n${s.content}`)
        .join("\n\n");
      newMarkdown += `\n\n## 补充内容\n根据反馈「${state.userFeedback}」补充的分析内容（Mock 模式）。配置 DEEPSEEK_API_KEY 后由 LLM 生成。`;
    }

    const newSections = parseSections(newMarkdown);

    return {
      documents: {
        ...state.documents,
        [docType]: {
          ...existing,
          sections: newSections,
          status: "review" as const,
        },
      },
      userFeedback: null,
    };
  }

  // === 情况 2: 新生成 ===
  console.log("   模式: 新生成");

  let markdown: string;

  if (hasLLM()) {
    markdown = await realGenerate(docType, state.userRequest, state.researchResults);
  } else {
    // Mock: 使用预设模板
    const mockDoc = mockDocument(docType, state.userRequest);
    markdown = mockDoc.sections.map(s => `## ${s.title}\n${s.content}`).join("\n\n");
  }

  const sections = parseSections(markdown);

  // 标记对应 task 为完成
  const taskType = `write_${docType.replace("user_", "").replace("_analysis", "").replace("_flow", "").replace("competitor", "competitor")}`;

  console.log(`   生成 ${sections.length} 个章节`);

  return {
    documents: {
      ...state.documents,
      [docType]: {
        type: docType,
        title: DOC_TITLES[docType] || docType,
        sections,
        status: "generating" as const,
      },
    },
    currentDocument: docType,
  };
}
