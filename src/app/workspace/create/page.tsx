// app/workspace/create/page.tsx — 新项目入口（Server Component）
//
// 作用：承接首页跳转 /workspace/create?q=产品想法，把需求转交给
//       WorkspaceShell 的 create 模式（真正的 Agent 分析由 Shell 发起）。
//
// ── 为什么这段代码需要 async + Suspense？逐点拆解 ──
//
// 1) 为什么是 async？
//    Next.js 15+ 把路由的动态 API（params / searchParams）统一改成了异步的：
//    它们返回的是 Promise。要读 URL 查询参数就必须 await，
//    而 await 只能出现在 async 函数里 → 所以 Page 必须是 async Server Component。
//
// 2) 为什么拆一个子组件 CreateWorkspace + 包一层 Suspense？
//    Next 官方推荐的写法是：把「依赖运行时数据、可能挂起(suspend)」的部分
//    用 <Suspense> 包起来，Next 就能先流式渲染 fallback，等数据就绪再替换成真实 UI，
//    而不是让整条路由一起干等。
//
// 3) 备注：
//    本文件里 await searchParams 写在了 Page 顶层、位于 <Suspense> 之外，
//    而本路由又是 force-dynamic——URL 参数对请求来说几乎立即可得，
//    所以这个 await 基本不会真挂起，fallback「正在加载工作台…」实际很少出现。
//    它属于「按官方示例写的防御性边界」，无害但并非本页的唯一加载手段。
//    若想语义更严谨（让读参数本身也进入加载态），把 await 下沉到 CreateWorkspace 里即可。

import { Suspense } from "react";
import { WorkspaceShell } from "@/components/workspace/workspace-shell";

// 不做静态预渲染：本页要读运行时 URL 参数、之后还要触发 Agent/DB 写入，不能缓存
export const dynamic = "force-dynamic";

// 子组件：从 Server 拿到已解析好的 q，交给客户端大脑 WorkspaceShell
// （它才是 "use client" 的那一个；Server 组件只负责把 q 当 prop 传下去）
// projectId=null + initialRequest=q → WorkspaceShell 据此进入 create 模式：
//   挂载后自动 POST /api/pm/analyze 发起 Agent 执行，收到 done 拿到 projectId
//   后用 router.replace 跳到 /workspace/:id（existing 模式，从 DB 恢复现场）。
async function CreateWorkspace({ q }: { q: string | null }) {
  return <WorkspaceShell projectId={null} initialRequest={q} />;
}

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>; // Next 15+: 动态路由 API 都是 Promise，必须 await
}) {
  // ===== 唯一真正做的事：读 URL 上的产品想法并传给 Shell =====
  const { q } = await searchParams;
  const request = q?.trim() || null;

  return (
    // Suspense：异步数据边界。边界内若在等异步渲染，先显示 fallback，不阻塞整页。
    // 注意：如上注释，真正的「加载态」主要来自页面自身的服务端渲染；
    // 这里更多是让结构符合 Next 对「读运行时数据的分段要包 Suspense」的约定。
    <Suspense
      fallback={
        <div className="flex h-dvh items-center justify-center text-sm text-muted-foreground">
          正在加载工作台…
        </div>
      }
    >
      <CreateWorkspace q={request} />
    </Suspense>
  );
}
