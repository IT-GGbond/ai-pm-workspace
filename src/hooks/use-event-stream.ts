"use client";

// hooks/use-event-stream.ts — 消费后端自定义 SSE 事件流
//
// 后端 SSE 协议（见 src/lib/sse.ts）:
//   event: message
//   data: {"type":"node_start","node":"writer"}
//   data: {"type":"node_output","node":"writer","data":{...}}
//   data: {"type":"interrupt","documentTitle":"..."}
//   data: {"type":"done","projectId":"...","status":"waiting_review"}
//
// 本 Hook 负责:
//   1. POST 到 analyze/feedback，用 fetch + ReadableStream 逐帧解析 data: 行
//   2. 每帧 JSON.parse 后回调 onEvent（与 useChat 文本流不同，这里是结构化事件）
//   3. 发起新请求前自动 abort 上一个连接（如 feedback 替换 analyze 流）
//
// 参考: node_modules/next/dist/docs/01-app/01-getting-started/15-route-handlers.md
//       服务端通过 ReadableStream + TextEncoder 流式返回 text/event-stream

import { useCallback, useRef } from "react";
import type { SSEEvent } from "@/lib/sse";

interface UseEventStreamOptions {
  onEvent: (event: SSEEvent) => void;
  onError?: (message: string) => void;
}

export function useEventStream({ onEvent, onError }: UseEventStreamOptions) {
  const controllerRef = useRef<AbortController | null>(null);

  // 用 ref 保存最新回调，使 start/abort 引用恒定。
  // 若直接依赖 onEvent（其可能依赖 state），onEvent 一变 → start 重建 → 调用方 effect 重跑，
  // 在 React StrictMode 下会引发级联重连 / 误 abort。ref 方案切断这条链。
  const onEventRef = useRef(onEvent);
  const onErrorRef = useRef(onError);
  onEventRef.current = onEvent;
  onErrorRef.current = onError;

  const start = useCallback(async (url: string, body: Record<string, unknown>) => {
    // 新请求替换旧连接（feedback 续跑时会中断 analyze 的空闲流）
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;

    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const text = await res.text();
        onErrorRef.current?.(`请求失败 (${res.status}): ${text.slice(0, 120)}`);
        return;
      }

      // === 按 SSE 帧分隔符 \n\n 逐帧解析 data: 行 ===
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";

      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });

        const frames = buf.split("\n\n");
        buf = frames.pop() ?? "";
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((l) => l.startsWith("data:"));
          if (!dataLine) continue;
          try {
            onEventRef.current(JSON.parse(dataLine.slice(5)) as SSEEvent);
          } catch {
            // 跳过无法解析的帧（心跳/注释行），不中断流
          }
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") {
        onErrorRef.current?.((err as Error).message || "网络连接失败");
      }
    }
  }, []);

  const abort = useCallback(() => controllerRef.current?.abort(), []);

  return { start, abort };
}
