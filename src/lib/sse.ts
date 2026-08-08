// lib/sse.ts — SSE (Server-Sent Events) 编码工具
//
// 把结构化事件编码成 text/event-stream 格式，供 analyze/feedback 路由使用
// SSE 协议: 每条事件 = "event: <name>\ndata: <json>\n\n"
// 前端统一用 fetch + ReadableStream 解析 data 字段，靠事件里的 type 字段区分
//
// 参考: Next.js 16 streaming.md "Streaming in Route Handlers"
//       https://nextjs.org/docs/app/guides/streaming#streaming-in-route-handlers

const encoder = new TextEncoder();

/** SSE 事件统一结构 — type 区分事件种类 */
export interface SSEEvent {
  type: "node_start" | "node_output" | "interrupt" | "done" | "error";
  node?: string;
  data?: unknown;
  message?: string;
  projectId?: string;
  status?: string;
  documentType?: string;
  documentTitle?: string;
  [key: string]: unknown;
}

/** 编码单条 SSE 事件 → Uint8Array */
export function encodeSSE(event: SSEEvent): Uint8Array {
  const payload = `event: message\ndata: ${JSON.stringify(event)}\n\n`;
  return encoder.encode(payload);
}

/** 心跳帧: 防止代理/中间层因空闲断开长连接 */
export function encodeHeartbeat(): Uint8Array {
  return encoder.encode(": ping\n\n");
}

/** SSE 响应需要的 Headers */
export const SSE_HEADERS: Record<string, string> = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "X-Accel-Buffering": "no", // 关闭 Nginx 缓冲，保证流式实时到达
};
