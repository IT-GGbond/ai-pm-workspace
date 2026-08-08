// components/markdown.tsx — Markdown 渲染封装
//
// 用 react-markdown 把 writer 生成的 Markdown 章节渲染成文档排版
// 用 components 映射把原始标签升级为带 Tailwind 语义的标签
// 文档正文用衬线栈（Georgia + 中文宋体回退），强化「纸面文档」质感

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm"; // GFM 插件: 让 | 语法表格按 <table> 渲染（默认 react-markdown 不支持表格）
import type { Components } from "react-markdown";
import { cn } from "@/lib/utils";

const mdComponents: Components = {
  h1: ({ children, ...props }) => (
    <h1 {...props} className="mt-8 mb-3 text-2xl font-semibold tracking-tight first:mt-0">
      {children}
    </h1>
  ),
  h2: ({ children, ...props }) => (
    <h2 {...props} className="mt-6 mb-2 border-b border-border/60 pb-1.5 text-lg font-semibold">
      {children}
    </h2>
  ),
  h3: ({ children, ...props }) => (
    <h3 {...props} className="mt-4 mb-1.5 text-base font-semibold">
      {children}
    </h3>
  ),
  p: ({ children, ...props }) => (
    <p {...props} className="my-2.5 leading-7 text-foreground/90">
      {children}
    </p>
  ),
  ul: ({ children, ...props }) => (
    <ul {...props} className="my-2.5 list-disc pl-6 space-y-1">
      {children}
    </ul>
  ),
  ol: ({ children, ...props }) => (
    <ol {...props} className="my-2.5 list-decimal pl-6 space-y-1">
      {children}
    </ol>
  ),
  li: ({ children, ...props }) => (
    <li {...props} className="leading-7">
      {children}
    </li>
  ),
  strong: ({ children, ...props }) => (
    <strong {...props} className="font-semibold text-foreground">
      {children}
    </strong>
  ),
  blockquote: ({ children, ...props }) => (
    <blockquote {...props} className="my-3 border-l-2 border-primary/40 pl-4 italic text-foreground/75">
      {children}
    </blockquote>
  ),
  code: ({ children, ...props }) => (
    <code
      {...props}
      className="rounded bg-muted px-1.5 py-0.5 font-mono text-[0.85em] text-foreground"
    >
      {children}
    </code>
  ),
  a: ({ children, ...props }) => (
    <a {...props} className="text-primary underline underline-offset-2 hover:text-primary/80" target="_blank" rel="noreferrer">
      {children}
    </a>
  ),
  table: ({ children, ...props }) => (
    <div className="my-3 overflow-x-auto rounded border border-border">
      <table {...props} className="w-full border-collapse text-sm">
        {children}
      </table>
    </div>
  ),
  th: ({ children, ...props }) => (
    <th {...props} className="border-b border-border bg-muted/50 px-3 py-1.5 text-left font-semibold">
      {children}
    </th>
  ),
  td: ({ children, ...props }) => (
    <td {...props} className="border-b border-border/60 px-3 py-1.5 align-top">
      {children}
    </td>
  ),
};

interface MarkdownProps {
  content: string;
  className?: string;
}

/** 渲染一段 Markdown 内容为文档排版 */
export function Markdown({ content, className }: MarkdownProps) {
  return (
    <div
      className={cn(
        // 文档正文：衬线栈 + 纸面感行距
        "font-serif [font-family:Georgia,'Songti_SC','Noto_Serif_SC','SimSun',serif]",
        "text-[0.975rem] text-foreground/90",
        className,
      )}
    >
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={mdComponents}>
        {content}
      </ReactMarkdown>
    </div>
  );
}
