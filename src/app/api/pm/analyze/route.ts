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
  // === 1.校验输入 ===
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

  // === 2. 创建 Project 记录（thread_id 用 project.id，feedback 路由据此恢复） ===
  const project = await prisma.project.create({
    data: {
      name: userRequest.slice(0, 20),
      description: userRequest,
      status: "in_progress",
    },
  });
  // === 3. 构造 ReadableStream（核心：这是 Web Standard 的流）===
  //
  // 为什么用 new ReadableStream？
  // ┌─────────────────────────────────────────────────────────────┐
  // │  App Router 的 API Route 必须返回 Response 对象              │
  // │  Response 构造函数签名：new Response(body, init)             │
  // │                                                             │
  // │  body 可以是：                                              │
  // │    - string / Blob / ArrayBuffer / FormData                 │
  // │    - Uint8Array                                             │
  // │    - ReadableStream（← 流式响应的唯一选择）                  │
  // │                                                             │
  // │  如果你返回字符串：浏览器会等整个字符串生成完才收到响应头    │
  // │  如果你返回 ReadableStream：浏览器立即收到响应头，然后      │
  // │    通过 HTTP Chunked Transfer-Encoding 一块一块接收数据      │
  // └─────────────────────────────────────────────────────────────┘
  //
  // ReadableStream 构造函数接收一个 "underlying source" 对象：
  //   { start(controller), pull(controller), cancel(reason) }
  //
  // controller 是流的控制器，有两个关键方法：
  //   - controller.enqueue(chunk) : 把一块数据推入流（chunk 必须是 Uint8Array）
  //   - controller.close()        : 关闭流，前端 reader.read() 得到 done: true
  const stream = new ReadableStream<Uint8Array>({
    // start 在流被构造时立即执行，适合初始化逻辑
    async start(controller) {
      // 封装一个快捷函数：把业务事件对象 → SSE 文本帧 → Uint8Array → 推入流
      // encodeSSE 大概长这样：
      //   (event) => new TextEncoder().encode(
      //     `event: message\n` +
      //     `data: ${JSON.stringify(event)}\n\n`
      //   )
      const enqueue = (event: Parameters<typeof encodeSSE>[0]) =>
        controller.enqueue(encodeSSE(event));

      try {
        // === 4. 启动 LangGraph 流式执行 ===
        // app.stream() 返回的是一个 AsyncGenerator，每次 yield 一个节点更新
        // 这和 ReadableStream 是"两个世界的流"：
        //   - app.stream() 是 AsyncIterable（语言级异步迭代）
        //   - ReadableStream 是 Web Standard 字节流（网络传输级）
        // 我们需要在两者之间做"桥接"：把 AsyncGenerator 的每个值，手动 enqueue 进 ReadableStream
        const graphStream = await app.stream(
          { userRequest },
          { configurable: { thread_id: project.id }, streamMode: "updates" },
        );

        // runAgentStream 内部大概会这样迭代：
        //   for await (const update of graphStream) {
        //     controller.enqueue(encodeSSE({ type: 'node_output', ... }))
        //   }
        // 它接收 controller 是为了在迭代过程中实时 push 数据
        const { interrupted } = await runAgentStream(
          controller, // ← 把流的控制权传进去，让 runner 能实时 push
          project.id,
          graphStream,
        );

        // === 5. 根据执行结果发送收尾事件 ===
        if (interrupted) {
          // HITL（Human-in-the-loop）暂停：Agent 写完一篇文档，等用户审阅
          await prisma.project.update({
            where: { id: project.id },
            data: { status: "in_progress" },
          });
          // 推入最后一个 SSE 帧，告诉前端"暂停了，等用户输入"
          enqueue({
            type: "done",
            projectId: project.id,
            status: "waiting_review",
          });
        } else {
          // 全部完成（无暂停，理论上不会走到：每篇文档都会暂停审阅）
          await prisma.project.update({
            where: { id: project.id },
            data: { status: "completed" },
          });
          enqueue({ type: "done", projectId: project.id, status: "completed" });
        }
      } catch (err) {
        // 异常时也要推一个 error 事件给前端，不能默默挂掉
        console.error("[analyze] Agent 执行失败:", err);
        enqueue({
          type: "error",
          message: (err as Error).message || "Agent 执行失败",
        });
      } finally {
        // 无论成功失败，必须关闭流！
        // 否则前端 reader.read() 永远等不到 done: true，连接会挂死
        controller.close();
      }
    },

    // pull(controller) 是"按需拉取"模式用的：
    // 前端 reader.read() 时，如果流里没数据，会触发 pull 来生成更多数据。
    // 但这里 LangGraph 是"主动推送"模型（start 里就 for await 循环了），
    // 所以不需要实现 pull。
    // pull 更适合：视频流、大文件下载等"前端读一点，后端生成一点"的场景。

    // cancel(reason) 在前端主动断开时触发：
    // 例如前端调用了 abort() 或关闭了页面。
    // 可以在这里做清理工作（如中断 LangGraph 执行）。
    cancel(reason) {
      console.log("[analyze] 前端取消了连接:", reason);
      // 如果有办法中断 app.stream()，在这里做
    },
  });

  // === 6. 返回 Response ===
  // 这是 App Router 唯一合法的返回方式。
  // stream 作为 body，浏览器/前端 fetch 会立即收到响应头，
  // 然后通过 res.body.getReader() 逐块读取 stream 里的数据。
  //
  // SSE_HEADERS 大概长这样：
  //   {
  //     'Content-Type': 'text/event-stream',
  //     'Cache-Control': 'no-cache, no-transform',
  //     'Connection': 'keep-alive',
  //     'X-Accel-Buffering': 'no',
  //   }
  return new Response(stream, { headers: SSE_HEADERS });
}
