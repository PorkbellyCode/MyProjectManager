"use client";

import { useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Pencil } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { AiLabel, aiScopeStyle } from "@/components/review/ai-frame";
import { editSummaryAction } from "@/app/p/[projectId]/tickets/actions";
import type { SummaryView } from "@/lib/tickets/detail";
import { cn } from "@/lib/utils";
import { MarkdownView } from "./markdown";
import { useTicketAction } from "./use-ticket-action";

/** 정리본 마크다운의 "> 인터뷰 없이 제출됨" 줄은 위의 표시와 겹치므로 화면에서만 뺀다(저장된 글은 그대로). */
const withoutOriginOnlyNote = (md: string) => md.replace(/\n*^> 인터뷰 없이 제출됨$\n*/m, "\n\n").trim();

const editSchema = z.object({ markdown: z.string().trim().min(1, "정리본 내용을 입력해 주세요.").max(50_000) });

/**
 * 정리본(상세 맨 위). 인터뷰 없이 만든 정리본은 "인터뷰 없이 제출됨" 표시가 붙는다.
 * 요청자는 담당자가 일을 시작하기 전(큐 대기·배정됨)까지 고칠 수 있다. 아직 만들어지는 중이면 자리표시를 보인다.
 */
export function SummaryPanel({
  projectId,
  ticketId,
  version,
  summary,
  editable,
  provider,
  pending: generating,
}: {
  projectId: string;
  ticketId: string;
  version: number;
  summary: SummaryView | null;
  editable: boolean;
  provider: string | null;
  /** 정리본을 기다리는 중(제출 직후). */
  pending: boolean;
}) {
  const [editing, setEditing] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { execute, pending } = useTicketAction();
  const form = useForm<{ markdown: string }>({ resolver: zodResolver(editSchema), defaultValues: { markdown: summary?.markdown ?? "" } });

  const edited = !!summary?.editedAt;
  const onSave = form.handleSubmit((v) =>
    execute(() => editSummaryAction(projectId, ticketId, { expectedVersion: version, markdown: v.markdown }), {
      success: "정리본을 고쳤어요.",
      onSuccess: () => setEditing(false),
    }),
  );

  return (
    <section
      aria-label="정리본"
      className={cn("rise flex flex-col gap-4 rounded-[14px] border p-6", edited ? "border-line bg-surface" : "ai-scope border-ai-ring bg-ai-tint")}
      style={edited ? undefined : aiScopeStyle(provider)}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        {edited ? <span className="text-sm font-semibold">정리본</span> : <AiLabel provider={provider} suffix="정리본" />}
        {summary?.generatedFrom === "original_only" && (
          <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-muted-text">인터뷰 없이 제출됨</span>
        )}
        {edited && <span className="rounded-full bg-sunken px-2.5 py-0.5 text-xs text-muted-text">요청자가 고침</span>}
        {editable && !editing && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="ml-auto rounded-lg"
            onClick={() => {
              form.reset({ markdown: summary?.markdown ?? "" });
              setEditing(true);
            }}
          >
            <Pencil aria-hidden />
            정리본 고치기
          </Button>
        )}
      </div>

      {!summary ? (
        <p className="text-[15px] leading-[1.75] text-muted-text" role="status">
          {generating ? "정리본을 만들고 있어요. 잠시만 기다려 주세요." : "정리본이 없어요."}
        </p>
      ) : editing ? (
        <form onSubmit={onSave} noValidate className="flex flex-col gap-3">
          <Controller
            control={form.control}
            name="markdown"
            render={({ field }) => (
              <MarkdownEditor value={field.value} onChange={field.onChange} projectId={projectId} label="정리본" minHeight={200} onUploadingChange={setUploading} />
            )}
          />
          {form.formState.errors.markdown && <p className="text-sm text-destructive">{form.formState.errors.markdown.message}</p>}
          <p className="text-[13px] text-faint">고치면 담당자에게 알림이 가요. 담당자가 일을 시작한 뒤에는 댓글로 보충해 주세요.</p>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="ghost" className="rounded-[10px]" onClick={() => setEditing(false)}>
              취소
            </Button>
            <Button type="submit" className="rounded-[10px]" disabled={pending || uploading}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              저장
            </Button>
          </div>
        </form>
      ) : (
        <MarkdownView source={summary.generatedFrom === "original_only" ? withoutOriginOnlyNote(summary.markdown) : summary.markdown} className="mpm-summary" />
      )}
    </section>
  );
}
