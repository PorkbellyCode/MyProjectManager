"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { CheckCircle2, Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { EvidenceLink } from "@/components/review/evidence";
import { confirmFixedAction, reopenAction } from "@/app/p/[projectId]/tickets/actions";
import { useTicketAction } from "./use-ticket-action";

const reopenForm = z.object({ reason: z.string().trim().min(1, "아직인 이유를 적어 주세요.").max(2000) });

/** 확인 대기(resolved): 요청자가 "고쳐졌어요"(종결) 또는 "아직이에요"(사유 → 진행중). 처리 때 링크된 PR/커밋을 보인다. */
export function ConfirmCard({
  projectId,
  ticketId,
  version,
  linkedRefs,
  repoUrl,
}: {
  projectId: string;
  ticketId: string;
  version: number;
  linkedRefs: string[];
  repoUrl: string | null;
}) {
  const [reopening, setReopening] = useState(false);
  const confirm = useTicketAction();
  const reopen = useTicketAction();
  const form = useForm<z.infer<typeof reopenForm>>({ resolver: zodResolver(reopenForm), defaultValues: { reason: "" } });

  return (
    <section aria-label="처리 확인" className="rise flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-6">
      <p className="flex items-center gap-2 text-base font-semibold">
        <CheckCircle2 className="size-5 text-[#0D9488]" aria-hidden />
        처리가 끝났어요. 확인해 주세요.
      </p>
      {linkedRefs.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-text">관련 변경</h3>
          <ul className="flex flex-wrap gap-2">
            {linkedRefs.map((r) => (
              <li key={r}>
                <EvidenceLink item={{ ref: r }} projectId={projectId} repoUrl={repoUrl} />
              </li>
            ))}
          </ul>
        </div>
      )}
      {reopening ? (
        <form
          noValidate
          className="flex flex-col gap-2"
          onSubmit={form.handleSubmit((v) =>
            reopen.execute(() => reopenAction(projectId, ticketId, { expectedVersion: version, reason: v.reason }), { success: "다시 진행하도록 알렸어요." }),
          )}
        >
          <Textarea aria-label="아직인 이유" autoFocus placeholder="무엇이 아직 그대로인지 적어 주세요" {...form.register("reason")} aria-invalid={!!form.formState.errors.reason} />
          {form.formState.errors.reason && <p className="text-sm text-destructive">{form.formState.errors.reason.message}</p>}
          <div className="flex gap-2">
            <Button type="submit" className="rounded-[10px]" disabled={reopen.pending}>
              {reopen.pending && <Loader2 className="animate-spin" aria-hidden />}
              다시 열기
            </Button>
            <Button type="button" variant="ghost" className="rounded-[10px]" onClick={() => setReopening(false)}>
              취소
            </Button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button
            type="button"
            className="rounded-[10px]"
            disabled={confirm.pending}
            onClick={() => confirm.execute(() => confirmFixedAction(projectId, ticketId, { expectedVersion: version }), { success: "확인해 주셔서 고마워요. 종결했어요." })}
          >
            {confirm.pending && <Loader2 className="animate-spin" aria-hidden />}
            고쳐졌어요
          </Button>
          <Button type="button" variant="outline" className="rounded-[10px]" onClick={() => setReopening(true)}>
            아직이에요
          </Button>
        </div>
      )}
    </section>
  );
}
