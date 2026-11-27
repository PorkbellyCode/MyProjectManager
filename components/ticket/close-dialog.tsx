"use client";

import { useState } from "react";
import { Controller, useForm, useWatch } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2, Undo2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Sparkle } from "@/components/review/ai-frame";
import type { CloseReason } from "@/lib/db/schema/tickets";
import { CLOSE_REASON_LABEL, ticketRef } from "@/lib/tickets/labels";
import { closeAction } from "@/app/p/[projectId]/tickets/actions";
import { WITHDRAW_REASONS } from "@/app/p/[projectId]/tickets/schemas";
import { useTicketAction } from "./use-ticket-action";

const OTHER = "직접 입력";
const schema = z
  .object({ choice: z.string().min(1), other: z.string().max(2000) })
  .refine((v) => v.choice !== OTHER || v.other.trim().length > 0, { path: ["other"], message: "회수하는 이유를 적어 주세요." });

/**
 * 요청자의 회수(종결 사유 requester_withdrawn). 사유: "내 실수였어요" / "더 이상 필요 없어요" / 직접 입력.
 * 제출 이후 열린 상태(큐 대기·배정됨·진행중·보류·처리 완료)에서 쓸 수 있다.
 */
export function CloseDialog({ projectId, ticketId, version }: { projectId: string; ticketId: string; version: number }) {
  const [open, setOpen] = useState(false);
  const { execute, pending } = useTicketAction();
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { choice: WITHDRAW_REASONS[0], other: "" } });
  const choice = useWatch({ control: form.control, name: "choice" });

  const onSubmit = form.handleSubmit((v) => {
    const note = v.choice === OTHER ? v.other.trim() : v.choice;
    return execute(() => closeAction(projectId, ticketId, { expectedVersion: version, reason: "requester_withdrawn", note }), {
      success: "티켓을 회수했어요.",
      onSuccess: () => setOpen(false),
    });
  });

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="w-full rounded-[10px]">
          <Undo2 aria-hidden />
          회수
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>티켓을 회수할까요?</DialogTitle>
            <DialogDescription>회수하면 티켓이 종결되고 담당자에게 알림이 가요. 리드는 다시 열 수 있어요.</DialogDescription>
          </DialogHeader>
          <Controller
            control={form.control}
            name="choice"
            render={({ field }) => (
              <RadioGroup aria-label="회수 사유" value={field.value} onValueChange={field.onChange} className="gap-3">
                {[...WITHDRAW_REASONS, OTHER].map((r) => (
                  <div key={r} className="flex items-center gap-2.5">
                    <RadioGroupItem value={r} id={`withdraw-${r}`} />
                    <Label htmlFor={`withdraw-${r}`} className="font-normal">
                      {r}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
          {choice === OTHER && (
            <div className="flex flex-col gap-2">
              <Textarea aria-label="회수 사유 직접 입력" autoFocus placeholder="회수하는 이유" {...form.register("other")} aria-invalid={!!form.formState.errors.other} />
              {form.formState.errors.other && <p className="text-sm text-destructive">{form.formState.errors.other.message}</p>}
            </div>
          )}
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              회수하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const STAFF_REASON_HINT: Record<StaffReason, string> = {
  resolved_confirmed: "요청자 확인 없이도 해결된 게 분명할 때",
  duplicate: "같은 건이 이미 있을 때. 요청자와 구독자는 원본 티켓 알림을 받아요",
  wont_do: "하지 않기로 정했을 때(리드만)",
  other: "그 밖의 이유. 사유를 꼭 적어 주세요",
};

type StaffReason = Exclude<CloseReason, "requester_withdrawn">;

const staffSchema = z
  .object({
    reason: z.enum(["resolved_confirmed", "duplicate", "wont_do", "other"]),
    note: z.string().max(2000, "사유는 2000자 이하로 적어 주세요."),
    number: z.string(),
  })
  .superRefine((v, ctx) => {
    if (v.reason === "duplicate" && !/^#?\d{1,9}$/.test(v.number.trim())) {
      ctx.addIssue({ code: "custom", path: ["number"], message: "원본 티켓 번호를 적어 주세요." });
    }
    if (v.reason === "other" && !v.note.trim()) ctx.addIssue({ code: "custom", path: ["note"], message: "종결 사유를 적어 주세요." });
  });

/**
 * 처리 담당(개발자·리드)의 종결. 서버가 허용한 사유만 보인다(개발자에게는 "안 하기로 함"이 없다).
 * "중복"은 원본 번호를 받고, AI 비고나 검토 때 찾은 중복 후보가 있으면 미리 채운다.
 */
export function StaffCloseDialog({
  projectId,
  ticketId,
  version,
  reasons,
  duplicateCandidate,
}: {
  projectId: string;
  ticketId: string;
  version: number;
  reasons: CloseReason[];
  duplicateCandidate: { number: number; title: string } | null;
}) {
  const allowed = reasons.filter((r): r is StaffReason => r !== "requester_withdrawn");
  const [open, setOpen] = useState(false);
  const { execute, pending } = useTicketAction();
  const defaults = { reason: allowed[0] ?? "other", note: "", number: duplicateCandidate ? String(duplicateCandidate.number) : "" } as z.infer<typeof staffSchema>;
  const form = useForm<z.infer<typeof staffSchema>>({ resolver: zodResolver(staffSchema), defaultValues: defaults });
  const reason = useWatch({ control: form.control, name: "reason" });
  const errors = form.formState.errors;

  const onSubmit = form.handleSubmit((v) => {
    const note = v.note.trim() || undefined;
    const duplicateOfNumber = v.reason === "duplicate" ? Number(v.number.trim().replace(/^#/, "")) : undefined;
    return execute(() => closeAction(projectId, ticketId, { expectedVersion: version, reason: v.reason, note, duplicateOfNumber }), {
      success: "티켓을 종결했어요.",
      onSuccess: () => setOpen(false),
      onConflict: () => setOpen(false),
    });
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset(defaults);
      }}
    >
      <DialogTrigger asChild>
        <Button type="button" variant="outline" className="h-10 w-full rounded-[10px]">
          종결
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form onSubmit={onSubmit} noValidate className="flex flex-col gap-5">
          <DialogHeader>
            <DialogTitle>티켓을 종결할까요?</DialogTitle>
            <DialogDescription>요청자와 구독자에게 종결 알림이 가요. 리드는 다시 열 수 있어요.</DialogDescription>
          </DialogHeader>
          <Controller
            control={form.control}
            name="reason"
            render={({ field }) => (
              <RadioGroup aria-label="종결 사유" value={field.value} onValueChange={field.onChange} className="gap-3">
                {allowed.map((r) => (
                  <div key={r} className="flex items-start gap-2.5">
                    <RadioGroupItem value={r} id={`close-${r}`} className="mt-0.5" aria-describedby={`close-${r}-hint`} />
                    <div className="flex flex-col gap-0.5">
                      <Label htmlFor={`close-${r}`} className="font-normal">
                        {CLOSE_REASON_LABEL[r]}
                      </Label>
                      <span id={`close-${r}-hint`} className="text-[13px] text-faint">
                        {STAFF_REASON_HINT[r]}
                      </span>
                    </div>
                  </div>
                ))}
              </RadioGroup>
            )}
          />
          {reason === "duplicate" && (
            <div className="flex flex-col gap-2">
              <Label htmlFor="close-dup-number">원본 티켓 번호</Label>
              <Input id="close-dup-number" inputMode="numeric" placeholder="예: 3" className="w-32 font-mono" aria-invalid={!!errors.number} {...form.register("number")} />
              {duplicateCandidate && (
                <p className="ai-scope flex flex-wrap items-center gap-1.5 text-[13px] text-muted-text">
                  <Sparkle className="size-3.5 text-ai-text" />
                  AI가 찾은 후보로 채웠어요 · <span className="font-mono">{ticketRef(duplicateCandidate.number)}</span> {duplicateCandidate.title}
                </p>
              )}
              {errors.number && <p className="text-sm text-destructive">{errors.number.message}</p>}
            </div>
          )}
          <div className="flex flex-col gap-2">
            <Label htmlFor="close-note">{reason === "other" ? "종결 사유" : "메모(선택)"}</Label>
            <Textarea id="close-note" placeholder="요청자에게 보일 설명" aria-invalid={!!errors.note} {...form.register("note")} />
            {errors.note && <p className="text-sm text-destructive">{errors.note.message}</p>}
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              종결하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
