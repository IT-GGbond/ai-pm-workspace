// agent/visualize.ts — 生成 Agent 图可视化
// 运行: npx tsx src/agent/visualize.ts
//
// getGraphAsync 返回 Graph:
//   nodes: Record<string, Node>  (node id → node)
//   edges: Edge[]  ({ source: nodeId, target: nodeId, conditional?: boolean })

import { app } from "./graph";

async function main() {
  const graph = await app.getGraphAsync();

  // 1. Mermaid 格式（复制到 https://mermaid.live 查看）
  console.log("=== Mermaid 图 (https://mermaid.live) ===\n");
  console.log("```mermaid");
  console.log(graph.drawMermaid());
  console.log("```\n");

  // 2. 文本结构
  console.log("=== 图结构 ===");
  console.log(`节点: ${Object.keys(graph.nodes).join(", ")}`);
  console.log(`边:`);
  graph.edges.forEach((e) => {
    console.log(`  ${e.source} --${e.conditional ? "> (条件)" : ">"} ${e.target}`);
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
