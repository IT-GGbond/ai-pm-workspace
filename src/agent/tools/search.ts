// agent/tools/search.ts — Tavily 竞品搜索工具
// M1 阶段: 裸 fetch 调用，M2+ 封装为 MCP Server
// 无 API Key 时返回 mock 搜索结果

import type { ResearchSource } from "../state";

const TAVILY_API = "https://api.tavily.com/search";

// ===== Mock 搜索结果 =====

function mockSearch(query: string): ResearchSource[] {
  return [
    {
      title: `${query} - 竞品 A (市场领导者)`,
      url: "https://example.com/competitor-a",
      snippet: `关于"${query}"的市场领导者产品，拥有最大市场份额，核心功能包括 AI 驱动的内容推荐和社交互动。`,
    },
    {
      title: `${query} - 竞品 B (差异化竞争者)`,
      url: "https://example.com/competitor-b",
      snippet: `针对"${query}"细分人群的差异化产品，强调个性化学习路径和游戏化设计。`,
    },
    {
      title: `${query} - 竞品 C (新锐产品)`,
      url: "https://example.com/competitor-c",
      snippet: `2026年新上线的竞品，采用 AI 对话式交互模式，获得较高用户评价。`,
    },
  ];
}

// ===== 真实 Tavily 搜索 =====

async function realSearch(
  query: string,
  maxResults: number = 5,
): Promise<ResearchSource[]> {
  const res = await fetch(TAVILY_API, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      api_key: process.env.TAVILY_API_KEY,
      query,
      search_depth: "basic",
      max_results: maxResults,
    }),
  });

  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Tavily 搜索失败 (${res.status}): ${err}`);
  }

  const data = await res.json();
  return (data.results || []).map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.content,
  }));
}

// ===== 统一搜索入口 =====

export async function searchCompetitors(
  query: string,
  maxResults: number = 5,
): Promise<ResearchSource[]> {
  if (process.env.TAVILY_API_KEY) {
    try {
      return await realSearch(query, maxResults);
    } catch (err) {
      console.warn(`Tavily 搜索失败，降级为 mock: ${err}`);
    }
  }
  return mockSearch(query);
}
