# Agent 状态图

> 由 `npx tsx src/agent/visualize.ts` 生成，可在 GitHub / Mermaid Live 查看

## Mermaid 图

```mermaid
%%{init: {'flowchart': {'curve': 'linear'}}}%%
graph TD;
	__start__([<p>__start__</p>]):::first
	supervisor(🧠 Supervisor<br/>需求拆解 + 调度)
	research(🔍 Research<br/>Tavily 搜索 + LLM 摘要)
	writer(✍️ Writer<br/>LLM 生成文档章节)
	reviewer(🛡️ Reviewer<br/>LLM 质量审查)
	human_review(👤 Human Review<br/>interrupt 暂停等审批)
	__end__([<p>__end__</p>]):::last
	
	__start__ --> supervisor;
	human_review --> supervisor;
	research --> supervisor;
	writer --> reviewer;
	supervisor -.->|条件: nextAgent| research;
	supervisor -.->|条件: nextAgent| writer;
	supervisor -.->|条件: nextAgent| reviewer;
	supervisor -.->|条件: nextAgent| human_review;
	supervisor -.->|条件: null| __end__;
	reviewer -.->|条件: 不通过+未超限| writer;
	reviewer -.->|条件: 通过或超限| human_review;
	
	classDef default fill:#f2f0ff,line-height:1.2;
	classDef first fill-opacity:0;
	classDef last fill:#bfb6fc;
```

## 状态流转

```
START
  │
  ▼
┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
│Supervisor│───→│ Research │───→│Supervisor│───→│  Writer  │───→│ Reviewer │
│ 拆解任务 │    │ 竞品搜索 │    │ 调度写文档│    │ 生成文档 │    │ 质量审查 │
└──────────┘    └──────────┘    └──────────┘    └──────────┘    └─────┬────┘
                                             ▲                        │
                                             │     ┌──────────────────┤
                                             │     │ 通过 / 超限       │ 不通过+未超限
                                             │     ▼                  │
                                             │ ┌──────────┐          │
                                             │ │  Human   │          │
                                             │ │ Review   │◄─────────┘
                                             │ │ interrupt│
                                             │ └────┬─────┘
                                             │      │
                                             │      │ approve / modify / rewrite
                                             │      ▼
                                             └─────┘ (回到 Supervisor)
```

## 路由规则

| 路由 | 条件 | 目标 |
|------|------|------|
| supervisorRouter | `nextAgent === "research"` | Research |
| | `nextAgent === "writer"` | Writer |
| | `nextAgent === "reviewer"` | Reviewer |
| | `nextAgent === "human"` | Human Review |
| | 其他 | END |
| reviewerRouter | `reviewPassed === true` | Human Review |
| | `rewriteAttempts >= maxRewriteAttempts` | Human Review (强制人工) |
| | 其他 (不通过但未超限) | Writer (重写) |
