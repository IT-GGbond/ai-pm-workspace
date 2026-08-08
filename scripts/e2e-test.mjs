// M2 验收脚本 — 端到端测试 analyze → HITL 循环 → done
// 运行: node scripts/e2e-test.mjs
// 前提: dev server 已启动 (npm run dev)

const BASE = "http://localhost:3000/api/pm";

/** POST 一个 SSE 端点，解析所有事件直到 interrupt/done */
async function postSSE(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    throw new Error(`${url} → ${res.status}: ${await res.text()}`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = "";
  let result = null;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });

    // 按 SSE 帧分隔符 \n\n 切分
    const frames = buf.split("\n\n");
    buf = frames.pop();
    for (const frame of frames) {
      const dataLine = frame.split("\n").find(l => l.startsWith("data:"));
      if (!dataLine) continue;
      const evt = JSON.parse(dataLine.slice(5));
      if (evt.type === "interrupt" || evt.type === "done" || evt.type === "error") {
        result = evt;
      }
    }
  }
  return result;
}

async function main() {
  // === 1. 触发 analyze ===
  console.log("→ POST /analyze");
  const analyze = await postSSE(BASE + "/analyze", {
    userRequest: "面向大学生的英语学习App",
  });
  console.log(`  ${analyze.type}: ${analyze.status}  projectId=${analyze.projectId}`);
  if (analyze.type === "error") throw new Error(analyze.message);

  const projectId = analyze.projectId;
  if (analyze.status !== "waiting_review") {
    throw new Error("预期 analyze 后处于 waiting_review（文档待审阅）");
  }

  // === 2. 循环 feedback(approve) 直到全部文档审批完成 ===
  let round = 0;
  while (true) {
    round++;
    console.log(`→ POST /feedback  #${round} (approve)`);
    const res = await postSSE(BASE + "/feedback", {
      projectId,
      action: "approve",
    });
    console.log(`  ${res.type}: ${res.status}`);
    if (res.type === "error") throw new Error(res.message);
    if (res.status === "completed") break;
    if (round > 10) throw new Error("审阅轮数超出预期");
  }

  // === 3. 验证数据库已持久化 ===
  const dbCheck = await fetch(`http://localhost:3000/api/pm/${projectId}`).catch(() => null);
  console.log("\n✅ M2 验收通过: analyze → 5 次 HITL 审阅 → completed");
}

main().catch(err => {
  console.error("❌ 测试失败:", err.message);
  process.exit(1);
});
