"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { addCommentAction } from "@/app/p/[projectId]/tickets/actions";
import { addCommentSchema } from "@/app/p/[projectId]/tickets/schemas";
import { useTicketAction } from "./use-ticket-action";

/** 댓글 쓰기. 스크린샷은 붙여넣거나 끌어다 놓는다(편집기 업로드). 보내면 비운다. */
export function CommentBox({ projectId, ticketId }: { projectId: string; ticketId: string }) {
  const [uploading, setUploading] = useState(false);
  const { execute, pending } = useTicketAction();
  const form = useForm<{ body: string }>({ resolver: zodResolver(addCommentSchema), defaultValues: { body: "" } });
  const error = form.formState.errors.body?.message;
  // 빈 댓글(공백·빈 문단만)은 보낼 수 없다.
  const empty = !useWatch({ control: form.control, name: "body" })?.replace(/<[^>]*>|&nbsp;/g, "").trim();

  const onSubmit = form.handleSubmit((v) =>
    execute(() => addCommentAction(projectId, ticketId, v), { onSuccess: () => form.reset({ body: "" }) }),
  );

  return (
    <form onSubmit={onSubmit} noValidate className="flex flex-col gap-2">
      <span className="text-[13px] text-muted-text">댓글</span>
      <Controller
        control={form.control}
        name="body"
        render={({ field }) => (
          <MarkdownEditor
            value={field.value}
            onChange={field.onChange}
            projectId={projectId}
            label="댓글"
            minHeight={88}
            placeholder="댓글을 남기세요. 스크린샷은 붙여넣거나 끌어다 놓을 수 있어요."
            onUploadingChange={setUploading}
          />
        )}
      />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end">
        <Button type="submit" variant="outline" className="rounded-[10px]" disabled={pending || uploading || empty}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          댓글 남기기
        </Button>
      </div>
    </form>
  );
}
