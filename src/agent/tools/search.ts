// agent/tools/search.ts — Tavily 竞品搜索工具
// 使用 @langchain/tavily 官方包，替代手写 fetch
// TavilySearch 是 StructuredTool，自动读取 TAVILY_API_KEY
// 无 Key 时降级 mock，不抛异常

import type { ResearchSource } from "../state";

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
// 懒加载: 有 TAVILY_API_KEY 时才 import，避免无 Key 时抛异常

async function tavilySearch(query: string): Promise<ResearchSource[]> {
  // 动态 import 避免无 Key 时构造器抛异常
  const { TavilySearch } = await import("@langchain/tavily");
  const tool = new TavilySearch({ maxResults: 5, searchDepth: "basic" });
  const result = await tool.invoke({ query });

  // TavilySearch.invoke() 返回 string (JSON) 或对象
  const parsed = typeof result === "string" ? JSON.parse(result) : result;
  const items = Array.isArray(parsed) ? parsed : (parsed.results || []);
  return items.map((r: { title: string; url: string; content: string }) => ({
    title: r.title,
    url: r.url,
    snippet: r.content || "",
  }));
}

// ===== 统一入口 =====

export async function searchCompetitors(query: string): Promise<ResearchSource[]> {
  if (process.env.TAVILY_API_KEY) {
    try {
      return await tavilySearch(query);
    } catch (err) {
      console.warn("Tavily 搜索失败，降级 mock:", (err as Error).message);
    }
  }
  return mockSearch(query);
}
