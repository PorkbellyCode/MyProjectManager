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
import { closeAction } from "@/app/p/[projectId]/tickets/actions";
import { WITHDRAW_REASONS } from "@/app/p/[projectId]/tickets/schemas";
import { useTicketAction } from "./use-ticket-action";

const OTHER = "직접 입력";
const schema = z
  .object({ choice: z.string().min(1), other: z.string().max(2000) })
  .refine((v) => v.choice !== OTHER || v.other.trim().length > 0, { path: ["other"], message: "회수하는 이유를 적어 주세요." });

/**
 * 요청자의 회수(종결 사유 requester_withdrawn). 사유: "내 실수였어요" / "더 이상 필요 없어요" / 직접 입력.
 * 제출 이후 열린 상태(큐 대기·배정됨·진행중·보류·확인 대기)에서 쓸 수 있다.
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
