"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { TicketChip } from "@/components/ticket/ticket-chip";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { answerDuplicateAction } from "@/app/p/[projectId]/tickets/actions";
import type { TicketRefView } from "@/lib/tickets/detail";
import { ticketRef } from "@/lib/tickets/labels";
import { AiCard } from "./ai-frame";
import type { CardProps } from "./submit-as-is";

export type DuplicatePayload = {
  candidates: { ticketId: string; number: number | null; title: string; reason: string; differences: string }[];
};

/**
 * 중복 카드: 후보 티켓(번호·제목·상태)과 이유. "같은 건이에요"면 작성 내용이 그 티켓의 댓글이 되고 이 티켓은 철회된다.
 * 후보가 여럿이면 어느 티켓인지 고른다. "다른 건이에요"면 AI 판단과 달라도 그대로 다음 단계로 간다.
 */
export function DuplicateCard({ payload, refs, ...card }: CardProps & { payload: DuplicatePayload; refs: Record<string, TicketRefView> }) {
  const { execute, pending } = useTicketAction();
  const [choice, setChoice] = useState<"same" | "different" | null>(null);
  const many = payload.candidates.length > 1;
  const [picked, setPicked] = useState(payload.candidates[0]?.ticketId ?? "");

  const send = (c: "same" | "different") => {
    setChoice(c);
    const input = c === "same" ? { expectedVersion: card.version, choice: c, ticketIdToJoin: picked } : { expectedVersion: card.version, choice: c };
    void execute(() => answerDuplicateAction(card.projectId, card.ticketId, input));
  };

  const candidate = (c: DuplicatePayload["candidates"][number]) => {
    const ref = refs[c.ticketId];
    return (
      <div className="flex min-w-0 flex-col gap-2">
        <TicketChip projectId={card.projectId} t={{ id: c.ticketId, number: ref?.number ?? c.number ?? 0, title: ref?.title ?? c.title, status: ref?.status }} />
        <p className="text-[15px] leading-[1.75]">{c.reason}</p>
        {c.differences && <p className="text-[13px] leading-[1.6] text-muted-text">차이점: {c.differences}</p>}
      </div>
    );
  };

  return (
    <AiCard provider={card.provider} label="중복 확인 결과" heading="같은 건이 있어 보여요">
      {many ? (
        <RadioGroupPrimitive.Root aria-label="같은 건인 티켓" value={picked} onValueChange={setPicked} className="flex flex-col gap-3">
          {payload.candidates.map((c) => (
            <div key={c.ticketId} className="flex items-start gap-3 rounded-[10px] bg-surface/60 p-3">
              <RadioGroupPrimitive.Item
                value={c.ticketId}
                aria-label={`${ticketRef(refs[c.ticketId]?.number ?? c.number)} ${refs[c.ticketId]?.title ?? c.title}`}
                className="mt-2 flex size-4 shrink-0 items-center justify-center rounded-full border border-faint outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=checked]:border-brand"
              >
                <RadioGroupPrimitive.Indicator className="size-2 rounded-full bg-brand" />
              </RadioGroupPrimitive.Item>
              {candidate(c)}
            </div>
          ))}
        </RadioGroupPrimitive.Root>
      ) : (
        payload.candidates[0] && candidate(payload.candidates[0])
      )}
      <p className="text-[13px] leading-[1.6] text-muted-text">
        같은 건이면 작성하신 내용이 그 티켓에 댓글로 붙고, 진행 상황 알림을 같이 받아요.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="rounded-[10px]" disabled={pending || !picked} onClick={() => send("same")}>
          {pending && choice === "same" && <Loader2 className="animate-spin" aria-hidden />}
          같은 건이에요
        </Button>
        <Button type="button" variant="outline" className="rounded-[10px] bg-surface" disabled={pending} onClick={() => send("different")}>
          {pending && choice === "different" && <Loader2 className="animate-spin" aria-hidden />}
          다른 건이에요
        </Button>
      </div>
    </AiCard>
  );
}
