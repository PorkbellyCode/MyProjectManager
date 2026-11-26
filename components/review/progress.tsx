"use client";

import { Check } from "lucide-react";
import type { ReviewStage } from "@/lib/db/schema/tickets";
import { REVIEW_STAGES } from "@/lib/tickets/labels";
import type { Target } from "@/lib/tickets/targets";
import { cn } from "@/lib/utils";
import { AiCard } from "./ai-frame";
import { Poller } from "./poller";
import { SubmitAsIsButton, type CardProps } from "./submit-as-is";

/**
 * 검토 진행(ai_reviewing): "중복 확인 중 → 해소 확인 중 → 질문 준비 중 → 대상 추천 중"에서 지금 단계를 강조하고,
 * 1.5초마다 화면을 새로 고친다. "그대로 제출"은 언제나 보인다.
 */
export function ReviewProgress({ stage, round, target, ...card }: CardProps & { stage: ReviewStage | null; round: number; target: Target }) {
  const current = Math.max(0, REVIEW_STAGES.findIndex((s) => s.stage === stage));
  const label = REVIEW_STAGES[current].label;
  return (
    <AiCard provider={card.provider} label="AI 검토 진행" heading="검토 중">
      <Poller active />
      <p className="sr-only" role="status">
        {label}
      </p>
      <ol className="flex flex-wrap items-center gap-x-2 gap-y-3 text-sm">
        {REVIEW_STAGES.map((s, i) => {
          const done = i < current;
          const now = i === current;
          return (
            <li key={s.stage} className="flex items-center gap-2" aria-current={now ? "step" : undefined}>
              <span
                className={cn(
                  "inline-flex items-center gap-2 rounded-full px-3 py-1.5 transition-colors duration-300",
                  now && "bg-surface font-semibold text-text ring-1 ring-ai-ring",
                  done && "text-muted-text",
                  !now && !done && "text-faint",
                )}
              >
                {done ? (
                  <Check className="size-3.5 text-ai-text" aria-hidden />
                ) : (
                  <span aria-hidden className={cn("size-2 rounded-full", now ? "pulse-dot bg-ai-text" : "bg-line")} />
                )}
                {s.label}
                {now && s.stage === "interview" && round > 0 && <span className="font-mono text-xs text-faint">{round + 1}/2</span>}
                {done && <span className="sr-only">(끝남)</span>}
              </span>
              {i < REVIEW_STAGES.length - 1 && (
                <span aria-hidden className="text-faint">
                  →
                </span>
              )}
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[15px] leading-[1.7] text-muted-text">화면을 떠나도 돼요. 준비되면 알림을 드릴게요.</p>
        <SubmitAsIsButton {...card} target={target} />
      </div>
    </AiCard>
  );
}
