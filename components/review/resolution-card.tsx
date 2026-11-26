"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { answerResolutionAction } from "@/app/p/[projectId]/tickets/actions";
import type { TicketRefView } from "@/lib/tickets/detail";
import { WITHDRAW_LABEL } from "@/lib/tickets/labels";
import { AiCard } from "./ai-frame";
import { EvidenceLink, type EvidenceItem } from "./evidence";
import type { CardProps } from "./submit-as-is";

export type ResolutionPayload = {
  kind: "already_resolved" | "expected_behavior";
  message: string;
  evidence: EvidenceItem[];
  strength: "strong" | "weak";
};

type Choice = "resolved" | "continue" | "submit";

/**
 * 해소 카드: 근거가 있을 때만 뜬다. 유형 배지, 문구, 근거 링크(약한 근거는 "추정"). 자동 철회는 없고 요청자가 고른다.
 */
export function ResolutionCard({
  payload,
  refs,
  repoUrl,
  ...card
}: CardProps & { payload: ResolutionPayload; refs: Record<string, TicketRefView>; repoUrl: string | null }) {
  const { execute, pending } = useTicketAction();
  const [choice, setChoice] = useState<Choice | null>(null);
  const weak = payload.strength === "weak";
  const send = (c: Choice) => {
    setChoice(c);
    void execute(() => answerResolutionAction(card.projectId, card.ticketId, { expectedVersion: card.version, choice: c }));
  };
  const spin = (c: Choice) => pending && choice === c && <Loader2 className="animate-spin" aria-hidden />;
  return (
    <AiCard provider={card.provider} label="해소 확인 결과" heading={WITHDRAW_LABEL[payload.kind]}>
      <div className="flex flex-wrap items-center gap-2">
        {weak && <span className="rounded-full border border-line bg-surface px-2.5 py-0.5 text-xs font-medium text-muted-text">추정</span>}
      </div>
      <p className="text-[15px] leading-[1.75]">{payload.message}</p>
      {payload.evidence.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-xs font-medium text-muted-text">근거</h3>
          <ul className="flex flex-wrap gap-2">
            {payload.evidence.map((e) => (
              <li key={e.ref} className="min-w-0">
                <EvidenceLink item={e} projectId={card.projectId} repoUrl={repoUrl} refs={refs} weak={weak} />
              </li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-wrap gap-2">
        <Button type="button" className="rounded-[10px]" disabled={pending} onClick={() => send("resolved")}>
          {spin("resolved")}
          해결됐어요
        </Button>
        <Button type="button" variant="outline" className="rounded-[10px] bg-surface" disabled={pending} onClick={() => send("continue")}>
          {spin("continue")}
          인터뷰 계속
        </Button>
        <Button type="button" variant="ghost" className="rounded-[10px]" disabled={pending} onClick={() => send("submit")}>
          {spin("submit")}
          그대로 제출
        </Button>
      </div>
    </AiCard>
  );
}
