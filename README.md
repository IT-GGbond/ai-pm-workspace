# AI Product Manager

> 基于 LangGraph 的 Multi-Agent 产品协作平台。
> 输入一个产品想法 → Agent 协作调研竞品、生成 PRD/用户画像/竞品分析/功能流程/开发路线图 → 人工审阅迭代。

**一句话:** 不是"AI 写 PRD"，而是"AI 产品经理陪你一起做产品"。

## 技术栈

| 层级 | 选型 |
|------|------|
| 框架 | Next.js 16 (App Router) |
| 语言 | TypeScript 5.x |
| UI | Tailwind CSS + shadcn/ui |
| Agent 编排 | LangGraph.js 1.x (StateGraph + Checkpointer + HITL) |
| LLM | DeepSeek (开发) / Anthropic Claude (Demo) |
| 搜索 | Tavily API |
| 数据库 | Neon PostgreSQL + Prisma |
| 部署 | Vercel |

## 项目结构

```
ai-pm-workspace/
├── prisma/schema.prisma         # 数据模型
├── docs/                        # 架构文档 + Agent 状态图
├── src/
│   ├── agent/                   # Agent 核心 (LangGraph, 无框架依赖)
│   │   ├── graph.ts             # StateGraph 组装
│   │   ├── state.ts             # ProjectState 定义
│   │   ├── llm.ts               # LLM 调用封装
│   │   ├── nodes/               # 5 个节点 (supervisor/research/writer/reviewer/human-review)
│   │   └── tools/               # Tavily 搜索
│   ├── app/api/pm/              # API Route (SSE 流式 + JSON)
│   ├── app/                     # 页面 (App Router)
│   ├── components/              # React UI (工作台三栏 + shadcn/ui)
│   ├── hooks/                   # useEventStream
│   └── lib/                     # SSE / runner / prisma / types
└── scripts/                     # 测试脚本
```

完整目录架构: [docs/project-architecture.md](docs/project-architecture.md)

## 快速开始

```bash
# 1. 安装依赖
npm install

# 2. 配置环境变量
cp .env.example .env
# 编辑 .env 填入:
#   DEEPSEEK_API_KEY=sk-xxx    (开发用，便宜)
#   TAVILY_API_KEY=tvly-xxx    (竞品搜索，免费 1000 次/月)
#   DATABASE_URL=postgres://... (Neon PostgreSQL)

# 3. 同步数据库
npx prisma db push

# 4. 启动
npm run dev
# 打开 http://localhost:3000
```

## 命令行测试 (无需启动前端)

```bash
# 测试完整 Agent 链路
npx tsx src/agent/test-invoke.ts "设计一个宠物社交App"

# 生成 Agent 流程图
npx tsx src/agent/visualize.ts
```

## Agent 流水线

```
首页输入需求 → Supervisor 拆解任务 → Research 竞品搜索
  → Writer 生成文档 → Reviewer 质量审查 → 人工审阅 (HITL)
  → 确认后下一份文档 → ... → 5 份文档全部通过 → 完成
```

实时流式展示 Agent 思考过程：管线节点逐个亮起、日志流实时更新。

## 设计文档

项目设计文档在 `../z-AIPM/doc/`:
- [技术选型](../z-AIPM/doc/tech-selection.md)
- [产品设计](../z-AIPM/doc/product-design.md)
- [Agent 架构](../z-AIPM/doc/agent-architecture.md)
- [开发路线图](../z-AIPM/doc/development-roadmap.md)
- [API 层技术决策](../z-AIPM/doc/m2-tech-decisions.md) (SSE / interrupt / 数据流转)
- [模拟面试 Q&A](../z-AIPM/doc/interview-qa.md)

## 部署

```bash
# Vercel 一键部署
vercel --prod

# 需要的环境变量:
#   DEEPSEEK_API_KEY  /  ANTHROPIC_API_KEY
#   TAVILY_API_KEY
#   DATABASE_URL
```
