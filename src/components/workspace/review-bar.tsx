"use client";

// components/workspace/review-bar.tsx — 人机审阅操作栏（HITL）
//
// interrupt 暂停后显示在 AI 面板底部。三种动作:
//   - 确认通过  (approve)  → 立即 POST /api/pm/feedback，继续下一个文档
//   - 补充修改  (modify)   → 输入反馈 → 增量修改当前文档
//   - 重写文档  (rewrite)  → 输入反馈（可选）→ 重新生成
//
// 与后端 humanReviewNode 的三态 resume 一一对应

import { useState } from "react";
import { Check, Pencil, RefreshCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import type { InterruptInfo } from "@/lib/workspace-types";

interface ReviewBarProps {
  interrupt: InterruptInfo;
  busy?: boolean;
  onApprove: () => void;
  onModify: (feedback: string) => void;
  onRewrite: (feedback: string) => void;
}

type PickMode = "approve" | "modify" | "rewrite";

export function ReviewBar({ interrupt, busy, onApprove, onModify, onRewrite }: ReviewBarProps) {
  const [pick, setPick] = useState<PickMode | null>(null);
  const [feedback, setFeedback] = useState("");

  const submit = () => {
    if (pick === "approve") onApprove();
    else if (pick === "modify") onModify(feedback.trim());
    else if (pick === "rewrite") onRewrite(feedback.trim());
    setPick(null);
    setFeedback("");
  };

  const needInput = pick === "modify" || pick === "rewrite";

  return (
    <div className="border-t border-border bg-card/80 px-3 py-3">
      <div className="mb-2 flex items-center gap-2">
        <span className="size-2 animate-pulse rounded-full bg-[#B7791F]" />
        <span className="text-[13px] font-medium text-foreground">
          等待审阅「{interrupt.documentTitle}」
        </span>
      </div>
      <p className="mb-2 text-[11px] leading-4 text-muted-foreground">{interrupt.message}</p>

      {/* 反馈输入（modify/rewrite 时展开） */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          needInput ? "mb-2 max-h-32 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <Textarea
          value={feedback}
          onChange={e => setFeedback(e.target.value)}
          placeholder={
            pick === "modify" ? "输入修改意见，例如：加上扇贝单词作为竞品…" : "输入重写方向（可选）…"
          }
          className="min-h-16 resize-none text-xs"
        />
      </div>

      {/* 动作按钮 */}
      <div className="flex gap-1.5">
        <Button
          size="sm"
          className="flex-1 bg-[#1F7A4D] text-white hover:bg-[#1F7A4D]/80"
          disabled={busy}
          onClick={() => {
            setPick("approve");
            onApprove();
          }}
        >
          <Check /> 确认通过
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => setPick(pick === "modify" ? null : "modify")}
        >
          <Pencil /> 补充修改
        </Button>
        <Button
          size="sm"
          variant="outline"
          className="flex-1"
          disabled={busy}
          onClick={() => setPick(pick === "rewrite" ? null : "rewrite")}
        >
          <RefreshCcw /> 重写
        </Button>
      </div>

      {/* 提交（modify/rewrite 选中后显示） */}
      <div
        className={cn(
          "overflow-hidden transition-all duration-200",
          needInput ? "mt-2 max-h-10 opacity-100" : "max-h-0 opacity-0",
        )}
      >
        <Button size="sm" variant="secondary" className="w-full" disabled={busy} onClick={submit}>
          提交{ pick === "modify" ? "修改意见" : "并重写" }
        </Button>
      </div>
    </div>
  );
}
