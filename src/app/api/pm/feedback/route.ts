// app/api/pm/feedback/route.ts — HITL 反馈（SSE 流式）
//
// 请求:  POST /api/pm/feedback
//   { "projectId": "cuid...", "action": "approve|modify|rewrite", "feedback": "补充意见" }
// 响应:  text/event-stream，继续执行暂停的图，事件序列同 analyze
//
// 原理: 中断点是 human_review 节点里的 interrupt()
//       Command({ resume: { action, feedback } }) 恢复图 → interrupt() 返回该值
//       恢复后 human_review 根据 action:
//         approve → 标记文档 approved → Supervisor 调度下一个文档
//         modify/rewrite → 携带 feedback 回到 Writer 增量修改
//
// 文档参考: https://docs.langchain.com/oss/javascript/langgraph/interrupts
//           https://docs.langchain.com/oss/javascript/langgraph/graph-api

import { Command } from "@langchain/langgraph";
import { prisma } from "@/lib/prisma";
import { app } from "@/agent/graph";
import { encodeSSE, SSE_HEADERS } from "@/lib/sse";
import { runAgentStream } from "@/lib/agent-runner";

export const runtime = "nodejs";

export async function POST(req: Request) {
  // === 校验输入 ===
  let body: { projectId?: string; action?: string; feedback?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ error: "请求体必须是 JSON" }, { status: 400 });
  }

  const { projectId, action = "modify", feedback } = body;
  if (!projectId) {
    return Response.json({ error: "缺少 projectId 字段" }, { status: 400 });
  }
  if (!["approve", "modify", "rewrite"].includes(action)) {
    return Response.json({ error: "action 必须是 approve | modify | rewrite" }, { status: 400 });
  }

  // === 校验项目存在 ===
  const project = await prisma.project.findUnique({ where: { id: projectId } });
  if (!project) {
    return Response.json({ error: "项目不存在" }, { status: 404 });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enqueue = (event: Parameters<typeof encodeSSE>[0]) =>
        controller.enqueue(encodeSSE(event));

      try {
        // === 恢复图执行: Command({ resume }) 传回用户决策 ===
        const config = {
          configurable: { thread_id: projectId },
          streamMode: "updates" as const,
        };

        const graphStream = await app.stream(
          new Command({
            resume: { action, feedback: feedback?.trim() || undefined },
          }),
          config,
        );

        const { interrupted } = await runAgentStream(controller, projectId, graphStream);

        if (interrupted) {
          enqueue({ type: "done", projectId, status: "waiting_review" });
        } else {
          await prisma.project.update({
            where: { id: projectId },
            data: { status: "completed" },
          });
          enqueue({ type: "done", projectId, status: "completed" });
        }
      } catch (err) {
        console.error("[feedback] 恢复执行失败:", err);
        enqueue({ type: "error", message: (err as Error).message || "恢复执行失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, { headers: SSE_HEADERS });
}
