"use client";

import { TriangleAlert } from "lucide-react";
import type { Target } from "@/lib/tickets/targets";
import { SubmitAsIsButton, type CardProps } from "./submit-as-is";

export const FAILED_TEXT = "AI 검토에 실패했어요. 그대로 제출할 수 있어요.";

/** 실패 카드: 검토가 실패해도 티켓은 갇히지 않는다. 사람의 일이 아니므로 AI 바탕 대신 중립 카드로 보인다. */
export function FailedCard({ target, ...card }: CardProps & { target: Target }) {
  return (
    <section aria-label="AI 검토 실패" className="rise flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-6">
      <p className="flex items-start gap-2.5 text-[15px] leading-[1.75]">
        <TriangleAlert className="mt-1 size-4 shrink-0 text-destructive" aria-hidden />
        {FAILED_TEXT}
      </p>
      <div>
        <SubmitAsIsButton {...card} target={target} variant="default" />
      </div>
    </section>
  );
}
