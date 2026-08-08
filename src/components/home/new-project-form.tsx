"use client";

// components/home/new-project-form.tsx — 首页需求输入框
//
// 提交后跳转到 /workspace/create?q=...（工作台 create 模式负责发起 analyze）
// 用 URL 传递需求而非先 POST：让工作台从第一帧就展示 Agent 思考过程

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

export function NewProjectForm() {
  const [q, setQ] = useState("");
  const router = useRouter();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const text = q.trim();
    if (!text) return;
    router.push(`/workspace/create?q=${encodeURIComponent(text)}`);
  };

  return (
    <form onSubmit={submit} className="flex w-full flex-col gap-2 sm:flex-row">
      <Input
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder="例如：设计一个面向大学生的英语学习 App"
        className="h-12 flex-1 rounded-xl border-border bg-white px-4 text-base shadow-sm placeholder:text-muted-foreground/70"
        aria-label="产品想法"
      />
      <Button
        type="submit"
        disabled={!q.trim()}
        size="lg"
        className="h-12 shrink-0 rounded-xl bg-[#3456E6] px-6 text-white shadow-sm hover:bg-[#3456E6]/85 disabled:bg-muted disabled:text-muted-foreground"
      >
        开始分析
        <ArrowRight />
      </Button>
    </form>
  );
}
