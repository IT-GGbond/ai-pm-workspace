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
//
// 两种调用方式:
//   - generate(systemPrompt, userPrompt) → 纯文本（writer/research 用）
//   - createStructuredModel(zodSchema) → 结构化对象（supervisor/reviewer 用）
//
// modelKwargs 透传: ChatOpenAI.invocationParams() 会展开 this.modelKwargs 到请求体
//   利用这一点注入 DeepSeek thinking 关闭参数 → withStructuredOutput 正常工作

import { ChatAnthropic } from "@langchain/anthropic";
import { ChatDeepSeek } from "@langchain/deepseek";
import { SystemMessage, HumanMessage } from "@langchain/core/messages";
import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import type { z } from "zod";

// ===== API Key 检查 =====

export function hasLLM(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY || process.env.ANTHROPIC_API_KEY);
}

// ===== 创建 Chat Model（内部，不导出实例——避免跨请求共享状态） =====
// 优先级: DeepSeek (便宜, 开发) > Anthropic (Demo/面试)

function createModel(): BaseChatModel | null {
  if (process.env.DEEPSEEK_API_KEY) {
    return new ChatDeepSeek({
      model: "deepseek-v4-flash",
      temperature: 0.3,
      maxTokens: 8192,
      // DeepSeek V4 默认开启 thinking → tool_choice / response_format 报错
      // modelKwargs 会被 invocationParams() 展开进 API 请求体，实现 thinking: { type: "disabled" }
      // 参考: node_modules/@langchain/openai/dist/chat_models/completions.js L50
      modelKwargs: {
        thinking: { type: "disabled" as const },
      } as Record<string, unknown>,
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

// ===== 文本生成（writer / research 等自由文本节点用） =====

/**
 * 调用 LLM，返回文本内容。
 * 适用于不需要结构化输出的节点（writer 写文档、research 汇总搜索结果）。
 * @returns 文本内容，无 Key 返回 null → Node 降级 mock
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

// ===== 结构化输出（supervisor 拆解任务 / reviewer 审查文档用） =====

/**
 * 创建带 Zod Schema 约束的 LLM——原生 withStructuredOutput。
 * thinking 已通过 modelKwargs 关闭，tool calling 正常工作。
 *
 * @returns Runnable，无 Key 返回 null
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createStructuredModel(schema: z.ZodTypeAny): any | null {
  const model = createModel();
  if (!model) return null;
  return model.withStructuredOutput(schema);
}

/**
 * 结构化输出的降级方案：generate() + JSON 提取 + Zod 校验。
 * 当 withStructuredOutput 不可用时使用（如 Anthropic 模型）。
 */
export async function generateStructured<T extends z.ZodTypeAny>(
  schema: T,
  systemPrompt: string,
  userPrompt: string,
): Promise<z.infer<T> | null> {
  const text = await generate(systemPrompt, userPrompt);
  if (!text) return null;

  try {
    const match = text.match(/\{[\s\S]*\}/);
    const json = match ? JSON.parse(match[0]) : JSON.parse(text);
    return schema.parse(json) as z.infer<T>;
  } catch (err) {
    console.warn("[generateStructured] 解析失败:", (err as Error).message);
    return null;
  }
}
