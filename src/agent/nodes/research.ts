// agent/nodes/research.ts — 竞品搜索 + 市场调研
// 参考: z-AIPM/doc/agent-architecture.md 3.2 Research Agent

import type { StateType, ResearchResult } from "../state";
import { searchCompetitors } from "../tools/search";
import { generate, hasLLM, todayContext } from "../llm";

// ===== Mock 摘要 =====

function mockSummary(query: string): string {
  return `## 调研摘要: ${query}

### 市场概况
基于对 3 款主流竞品的分析，该细分市场呈现快速增长态势，2026 年市场规模预计达到数百亿元。

### 竞品特点
1. **竞品 A (市场领导者)**: 拥有最大的用户基数，产品成熟度高，但创新速度放缓
2. **竞品 B (差异化竞争者)**: 聚焦年轻用户群体，UI/UX 设计出色，但功能深度不足
3. **竞品 C (新锐产品)**: AI 原生设计，交互体验新颖，但用户规模尚小

### 用户痛点
- 现有产品学习门槛偏高
- 个性化推荐不够精准
- 跨平台体验割裂

### 机会点
- AI 能力可以显著降低使用门槛
- 细分人群（如大学生）的定制化需求未被满足
- 社交+学习的融合模式有创新空间`;
}

// ===== 主节点 =====

export async function researchNode(state: StateType) {
  console.log("\n🔍 [Research] 开始竞品调研...");

  const searchTasks = state.tasks.filter(t => t.type === "research");
  if (searchTasks.length === 0) {
    console.log("   无搜索任务，跳过");
    return {};
  }

  console.log(`   共 ${searchTasks.length} 个搜索任务，并行执行中...`);

  const results: ResearchResult[] = await Promise.all(
    searchTasks.map(async (task) => {
      // === 搜索查询: 优先 Supervisor 生成的 englishQuery，无需额外 LLM 调用 ===
      const searchQuery = task.englishQuery?.trim() || task.description;
      console.log(`   搜索: "${searchQuery}"`);
      const sources = await searchCompetitors(searchQuery);
      console.log(`   → 找到 ${sources.length} 条结果，LLM 摘要中...`);

      const summary = hasLLM()
        ? await generate(
            `你是市场研究专家，擅长从竞品数据中提炼洞察。当前日期: ${todayContext()}。使用 Markdown 格式输出。`,
            `基于以下搜索结果，为产品需求"${state.userRequest}"总结关键信息（注意当前是 ${todayContext()}，过时信息需标注）：

搜索结果：
${sources.map((s, i) => `${i + 1}. ${s.title}\n   ${s.snippet}`).join("\n\n")}

从以下角度总结（Markdown 格式）：
- 市场概况
- 竞品特点（逐一分析）
- 用户痛点
- 机会点`
          )
        : null;

      task.status = "completed";
      console.log(`   ✅ 摘要完成`);

      return { query: task.description, sources, summary: summary || mockSummary(task.description) };
    })
  );

  console.log(`\n   全部搜索完成，共 ${results.length} 组结果`);
  return { researchResults: results };
}
