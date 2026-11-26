"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { requestReviewAction } from "@/app/p/[projectId]/tickets/actions";
import type { Target } from "@/lib/tickets/targets";
import { Sparkle } from "./ai-frame";
import { SubmitAsIsButton, type CardProps } from "./submit-as-is";

/** 작성중(draft) 티켓: 검토를 요청하거나 바로 제출한다. */
export function DraftCard({ aiAvailable, target, ...card }: CardProps & { aiAvailable: boolean; target: Target }) {
  const { execute, pending } = useTicketAction();
  return (
    <section aria-label="작성중" className="rise flex flex-col gap-4 rounded-[14px] border border-dashed border-line bg-surface p-6">
      <p className="text-[15px] leading-[1.75] text-muted-text">
        아직 보내지 않은 티켓이에요.{aiAvailable ? "" : " 이 프로젝트는 AI 검토를 쓸 수 없어요. 바로 제출돼요."}
      </p>
      <div className="flex flex-wrap gap-2">
        {aiAvailable && (
          <Button
            type="button"
            className="rounded-[10px]"
            disabled={pending}
            onClick={() => execute(() => requestReviewAction(card.projectId, card.ticketId, { expectedVersion: card.version }))}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkle />}
            AI 검토 요청
          </Button>
        )}
        <SubmitAsIsButton {...card} target={target} label="바로 제출" variant={aiAvailable ? "outline" : "default"} />
      </div>
    </section>
  );
}
