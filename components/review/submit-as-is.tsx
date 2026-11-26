"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { submitAction } from "@/app/p/[projectId]/tickets/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import type { Target } from "@/lib/tickets/targets";

export type CardProps = { projectId: string; ticketId: string; version: number; provider: string | null };

/** "그대로 제출": 지금 정해 둔 대상(없으면 리드 큐)으로 바로 낸다. AI는 제출을 막지 않는다. */
export function SubmitAsIsButton({
  projectId,
  ticketId,
  version,
  target,
  variant = "outline",
  label = "그대로 제출",
}: Omit<CardProps, "provider"> & { target: Target; variant?: "outline" | "default" | "ghost"; label?: string }) {
  const { execute, pending } = useTicketAction();
  return (
    <Button
      type="button"
      variant={variant}
      className={variant === "outline" ? "rounded-[10px] bg-surface" : "rounded-[10px]"}
      disabled={pending}
      onClick={() => execute(() => submitAction(projectId, ticketId, { expectedVersion: version, target }), { success: "제출했어요." })}
    >
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {label}
    </Button>
  );
}
