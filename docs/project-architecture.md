# 项目文件架构

> 标注每个文件的职责，方便面试时快速定位。
> 54 个源文件 · 约 3500 行 TS/TSX

```
ai-pm-workspace/
│
│  ┌── 项目配置 ──────────────────────────────────────────┐
│  │
├── .env                          # 环境变量（API Key 等，不入 git）
├── .env.example                  # 环境变量模板（入 git，供新成员参考）
├── CLAUDE.md                     # Claude Code 项目说明（技术栈、架构、偏好）
├── AGENTS.md                     # Next.js 16 自动注入的代理规则（勿删）
├── next.config.ts                # Next.js 配置
├── postcss.config.mjs            # PostCSS / Tailwind 配置
├── eslint.config.mjs             # ESLint 规则
├── tsconfig.json                 # TypeScript 配置
│
│  ┌── 文档 ──────────────────────────────────────────────┐
│  │
├── README.md                     # 项目说明（运行步骤、技术栈）
├── docs/
│   ├── agent-graph.md            # Agent 状态图（Mermaid + 流转说明）
│   └── project-architecture.md   # 本文件：目录架构图
│
│  ┌── 数据层 ───────────────────────────────────────────┐
│  │
├── prisma/
│   └── schema.prisma             # 数据模型: Project → Document → Section + AgentLog
│
│  ┌── Agent 核心（无框架依赖的命令行可测试层）──────────┐
│  │
├── src/agent/
│   ├── state.ts                  # ProjectState 定义（Annotation.Root，14 个字段+reducer）
│   ├── graph.ts                  # StateGraph 组装（5 节点 + 条件边 + MemorySaver checkpointer）
│   ├── llm.ts                    # LLM 封装（ChatDeepSeek/ChatAnthropic + generate + withStructuredOutput）
│   ├── test-invoke.ts            # M1 验收脚本: npx tsx src/agent/test-invoke.ts
│   ├── visualize.ts              # 生成图可视化: npx tsx src/agent/visualize.ts
│   │
│   ├── nodes/                    # 5 个 Agent 节点（每个是一个 async function）
│   │   ├── supervisor.ts         # 🧠 需求分析 + 任务拆解（Zod 结构化输出）+ 调度决策
│   │   ├── research.ts           # 🔍 竞品搜索（Tavily）+ LLM 摘要
│   │   ├── writer.ts             # ✍️ LLM 生成 Markdown 文档 + 增量修改
│   │   ├── reviewer.ts           # 🛡️ LLM 质量审查（Zod 结构化输出）+ 重试上限
│   │   └── human-review.ts       # 👤 interrupt() 暂停 + approve/modify/rewrite 三态
│   │
│   └── tools/
│       └── search.ts             # Tavily 搜索工具（@langchain/tavily，无 Key 降级空数组）
│
│  ┌── 后端 API 层（Next.js Route Handler）──────────────┐
│  │
├── src/app/api/pm/
│   ├── analyze/route.ts          # POST 触发 Agent → SSE 流式返回 → 创建 Project
│   ├── feedback/route.ts         # POST 恢复 Agent（Command({ resume })）→ SSE 继续流
│   ├── projects/route.ts         # GET 项目列表（首页用，普通 JSON）
│   └── [id]/route.ts             # GET 单个项目详情（恢复现场用）
│
│  ┌── 前端页面层（App Router）──────────────────────────┐
│  │
├── src/app/
│   ├── layout.tsx                # 根布局
│   ├── page.tsx                  # 首页: Hero 输入框 + 最近项目列表（Server Component）
│   ├── globals.css               # Tailwind + 全局样式
│   │
│   └── workspace/
│       ├── create/page.tsx       # 新项目入口: /workspace/create?q=...（Server Component）
│       └── [id]/page.tsx         # 工作台详情: /workspace/:id（Server Component，查 DB 恢复）
│
│  ┌── 前端组件层 ───────────────────────────────────────┐
│  │
├── src/components/
│   ├── markdown.tsx              # Markdown 渲染（react-markdown + remark-gfm 表格支持）
│   │
│   ├── home/
│   │   └── new-project-form.tsx  # 首页输入框: router.push → /workspace/create?q=
│   │
│   ├── workspace/                # 工作台组件（全部 Client Component）
│   │   ├── workspace-shell.tsx   # 🏠 主容器: 三栏布局 + SSE 事件分发 + HITL 状态机
│   │   ├── doc-nav.tsx           # 📋 左栏: 5 种文档导航 + 状态徽章
│   │   ├── document-view.tsx     # 📄 中栏: 文档渲染（标题 + 章节列表 + Markdown）
│   │   ├── ai-panel.tsx          # 🤖 右栏: Agent 管线可视化 + 日志流 + 底部状态区
│   │   └── review-bar.tsx        # ✅ 审阅操作栏: 确认通过 / 补充修改 / 重写
│   │
│   └── ui/                       # shadcn/ui 基础组件（Button, Input, Textarea 等）
│       ├── badge.tsx
│       ├── button.tsx
│       ├── card.tsx
│       ├── input.tsx
│       ├── scroll-area.tsx
│       ├── separator.tsx
│       ├── sheet.tsx
│       ├── tabs.tsx
│       └── textarea.tsx
│
│  ┌── 前端工具层 ───────────────────────────────────────┐
│  │
├── src/hooks/
│   └── use-event-stream.ts       # SSE 消费 Hook: fetch + ReadableStream + 按帧 JSON.parse
│
├── src/lib/
│   ├── sse.ts                    # SSE 编码: encodeSSE() → text/event-stream 格式
│   ├── agent-runner.ts           # 核心胶水: LangGraph chunk → SSE 事件 + DB 持久化
│   ├── agent-logs.ts             # 持久化: AgentLog + Document/Section 落库
│   ├── prisma.ts                 # Prisma Client 单例（防热更新重复创建）
│   ├── utils.ts                  # 通用工具（cn() classname 合并）
│   └── workspace-types.ts        # 前端共享类型（DocData, LogEntry, InterruptInfo + 常量）
│
│  ┌── 测试与脚本 ───────────────────────────────────────┐
│  │
└── scripts/
    └── e2e-test.mjs              # M2 验收: curl 风格的端到端 SSE 测试
```

## 数据流概览

```
用户输入 → NewProjectForm → router.push → CreatePage(SSR)
  → WorkspaceShell(CSR) → useEffect → useEventStream.start()
  → fetch POST /api/pm/analyze → analyze/route.ts
  → app.stream({ userRequest }) → LangGraph 图执行
  → runAgentStream() → encodeSSE → controller.enqueue()
  → ReadableStream → reader.read() → JSON.parse
  → onEvent → React setState
  → AIPanel(管线) + DocumentView(Markdown) + DocNav(侧栏) + ReviewBar(审阅)
```

## 关键文件速查

| 要改什么 | 改哪个文件 |
|----------|-----------|
| 加一种新文档类型 | `state.ts` (Task type) → `supervisor.ts` (writeTypeToDocType) → `workspace-types.ts` (DOC_TYPES) |
| 改 Agent 流程图 | `graph.ts` (addNode/addEdge) → `supervisor.ts` (路由) → `visualize.ts` (重新生成图) |
| 改 SSE 事件格式 | `sse.ts` (SSEEvent 接口) → `agent-runner.ts` (encodeSSE 调用) → `workspace-shell.tsx` (onEvent 处理) |
| 改审阅逻辑 | `human-review.ts` (三态) → `review-bar.tsx` (按钮) |
| 加限流/鉴权 | `src/middleware.ts` (新建) |
| 上线前切 checkpoint | `graph.ts` (MemorySaver → PostgresSaver) |
