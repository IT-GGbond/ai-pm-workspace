// app/api/pm/analyze/route.ts — 触发 Agent 执行（SSE 流式）
//
// 请求:  POST /api/pm/analyze  { "userRequest": "设计一个英语学习App" }
// 响应:  text/event-stream，事件序列:
//   { type: "node_start", node }
//   { type: "node_output", node, data }        ← 每个节点的 state 更新
//   { type: "interrupt", documentTitle, message }  ← 到达 HITL 暂停点
//   { type: "done", projectId, status }        ← 流结束（completed / waiting_review）
//
// 架构: 前端 useChat/自定义 Hook → 本路由 → LangGraph graph.stream()
//       MemorySaver 跨请求共享（dev 同一进程），生产切 PostgresSaver

import { prisma } from "@/lib/prisma";
import { app } from "@/agent/graph";
import { encodeSSE, SSE_HEADERS } from "@/lib/sse";
import { runAgentStream } from "@/lib/agent-runner";

export const runtime = "nodejs"; // 需要 Node 运行时（Prisma + 长连接流式）

export async function POST(req: Request) {
  // === 校验输入 ===
  let body: { userRequest?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const userRequest = body.userRequest?.trim();
  if (!userRequest) {
    return Response.json({ error: "缺少 userRequest 字段" }, { status: 400 });
  }

  // === 创建 Project 记录（thread_id 用 project.id，feedback 路由据此恢复） ===
  const project = await prisma.project.create({
    data: {
      name: userRequest.slice(0, 20),
      description: userRequest,
      status: "in_progress",
    },
  });

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: Parameters<typeof encodeSSE>[0]) =>
        controller.enqueue(encodeSSE(event));

      try {
        // === 运行 LangGraph（updates mode: 每个节点完成后输出一次） ===
        const graphStream = await app.stream(
          { userRequest },
          { configurable: { thread_id: project.id }, streamMode: "updates" },
        );

        const { interrupted } = await runAgentStream(controller, project.id, graphStream);

        // === 收尾 ===
        if (interrupted) {
          // 到达 HITL 暂停点 → 前端应展示审阅栏
          await prisma.project.update({
            where: { id: project.id },
            data: { status: "in_progress" },
          });
          enqueue({ type: "done", projectId: project.id, status: "waiting_review" });
        } else {
          // 全部完成（无暂停，理论上不会走到：每篇文档都会暂停审阅）
          await prisma.project.update({
            where: { id: project.id },
            data: { status: "completed" },
          });
          enqueue({ type: "done", projectId: project.id, status: "completed" });
        }
      } catch (err) {
        console.error("[analyze] Agent 执行失败:", err);
        enqueue({ type: "error", message: (err as Error).message || "Agent 执行失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
