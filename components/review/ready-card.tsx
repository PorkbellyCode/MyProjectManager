"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { TargetPicker } from "@/components/ticket/target-picker";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { submitAction } from "@/app/p/[projectId]/tickets/actions";
import type { TargetOptions } from "@/lib/tickets/detail";
import type { Target } from "@/lib/tickets/targets";
import { AiCard } from "./ai-frame";
import type { CardProps } from "./submit-as-is";

export type ReadyPayload = { target: Target; reason: string; evidence: { ref: string; note: string }[] };

/** 준비 카드: 추천 대상이 미리 채워진 대상 고르기 + 강조된 "제출". 추천이 없으면 처음에 고른 대상이 채워진다. */
export function ReadyCard({
  payload,
  currentTarget,
  options,
  ...card
}: CardProps & { payload: ReadyPayload; currentTarget: Target; options: TargetOptions }) {
  const hasRec = payload.target !== null && !!payload.reason;
  const [target, setTarget] = useState<Target>(hasRec ? payload.target : currentTarget);
  const { execute, pending } = useTicketAction();
  return (
    <AiCard provider={card.provider} label="제출 준비" heading="제출 준비가 됐어요">
      <p className="text-[15px] leading-[1.75]">
        {hasRec ? "이 티켓을 맡을 곳을 추천해 두었어요. 확인하고 제출해 주세요. 바꿔도 괜찮아요." : "맡을 곳을 확인하고 제출해 주세요. 모르면 비워 두면 리드가 정해요."}
      </p>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <TargetPicker
            projectId={card.projectId}
            value={target}
            onChange={setTarget}
            options={options}
            recommended={hasRec ? { target: payload.target, reason: payload.reason, provider: card.provider } : null}
          />
        </div>
        <Button
          type="button"
          size="lg"
          className="h-11 rounded-[10px] px-6 text-[15px] font-semibold"
          disabled={pending}
          onClick={() => execute(() => submitAction(card.projectId, card.ticketId, { expectedVersion: card.version, target }), { success: "제출했어요." })}
        >
          {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
          제출
        </Button>
      </div>
    </AiCard>
  );
}
