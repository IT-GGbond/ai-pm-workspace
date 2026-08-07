// agent/llm.ts — LLM 调用封装（LangChain Chat Models）
//
// 核心决策: 用 LangChain Chat Models 替代 Vercel AI SDK 调 LLM
//   原因: LangChain Chat Models 跟 LangGraph 原生集成
//         - model.invoke(messages) 是 LangGraph 标准模式
//         - 自动支持 BaseMessage / SystemMessage / HumanMessage 格式
//         - bindTools / withStructuredOutput 开箱即用
//         - 后续切 Anthropic/OpenAI 只需改 model 实例，不改调用代码
//   Vercel AI SDK 保留给前端流式 UI (M2 useChat → SSE 桥接)
//
// 两种模式:
//   - 真实: .env 有 API_KEY → ChatDeepSeek(便宜) 或 ChatAnthropic(Demo)
//   - Mock: 无 Key → 返回 null，各 Node 降级为 mock 数据

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";

// ===== API Key 检查 =====

export function hasLLM(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// ===== 创建 Chat Model =====
// 优先级: DeepSeek (便宜, 开发) > Anthropic (Demo/面试)

function createModel(): BaseChatModel | null {
  if (process.env.DEEPSEEK_API_KEY) {
    return new ChatDeepSeek({
      model: "deepseek-chat",
      temperature: 0.3,
    });
  }

  if (process.env.ANTHROPIC_API_KEY) {
    return new ChatAnthropic({
      model: "claude-sonnet-5-20251001",
      temperature: 0.3,
    });
  }

  return null;
}

// ===== 统一 LLM 调用 =====

/**
 * 调用 LLM，返回文本内容
 * @param systemPrompt 系统提示词
 * @param userPrompt 用户提示词
 * @returns 文本，无 Key 返回 null → Node 降级 mock
 */
export async function generate(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  const model = createModel();
  if (!model) return null;

  const response = await model.invoke([
    new SystemMessage(systemPrompt),
    new HumanMessage(userPrompt),
  ]);

  if (typeof response.content === "string") {
    return response.content;
  }

  // content 可能是复杂结构（很少出现在纯文本场景）
  return JSON.stringify(response.content);
}
