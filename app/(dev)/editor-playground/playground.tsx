"use client";

import { useState } from "react";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Button } from "@/components/ui/button";

export function Playground({ projectId }: { projectId: string }) {
  const [markdown, setMarkdown] = useState("# 편집기 시험\n\n스크린샷을 붙여넣거나 끌어다 놓아 보세요.\n");
  const [uploading, setUploading] = useState(false);
  return (
    <main className="mx-auto max-w-3xl space-y-4 p-10">
      <h1 className="text-2xl font-semibold">편집기 시험</h1>
      <MarkdownEditor
        value={markdown}
        onChange={setMarkdown}
        projectId={projectId}
        placeholder="내용을 적어 주세요"
        label="요청 내용"
        minHeight={240}
        onUploadingChange={setUploading}
      />
      <Button type="button" disabled={uploading}>
        제출
      </Button>
      <pre data-testid="markdown-output" className="whitespace-pre-wrap rounded-[10px] border border-line bg-sunken p-4 font-mono text-xs">
        {markdown}
      </pre>
    </main>
  );
}
