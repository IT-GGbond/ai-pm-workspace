// agent/tools/search.ts — Tavily 竞品搜索工具
// 使用 @langchain/tavily 官方包，替代手写 fetch
// TavilySearch 是 StructuredTool，自动读取 TAVILY_API_KEY
// 无 Key 时降级 mock，不抛异常

import type { ResearchSource } from "../state";

// ===== Tavily 搜索 =====
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
      console.warn("Tavily 搜索失败:", (err as Error).message);
    }
  }
  // 无 API Key 或搜索失败: 返回空数组，上游 LLM 摘要时须处理空结果
  console.warn(`搜索 "${query}" 无结果（需配置 TAVILY_API_KEY）`);
  return [];
}
