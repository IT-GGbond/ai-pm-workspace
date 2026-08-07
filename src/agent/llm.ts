// agent/llm.ts — LLM 调用封装
// 两种模式:
//   - 真实: .env 中配置了 DEEPSEEK_API_KEY → 调 DeepSeek
//   - Mock: 未配置 → 返回 null，由各 Node 降级为 mock 数据

import { generateText } from "ai";
import { deepseek } from "@ai-sdk/deepseek";

/** 检查是否有可用的 LLM API Key */
export function hasLLM(): boolean {
  return Boolean(process.env.DEEPSEEK_API_KEY);
}

/** 调用 LLM，返回文本；无 Key 时返回 null */
export async function generate(
  systemPrompt: string,
  userPrompt: string,
): Promise<string | null> {
  if (!hasLLM()) return null;

  const { text } = await generateText({
    model: deepseek("deepseek-chat"),
    system: systemPrompt,
    prompt: userPrompt,
    temperature: 0.3,
  });
  return text;
}
