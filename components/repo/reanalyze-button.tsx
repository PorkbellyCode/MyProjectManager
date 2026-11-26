"use client";

import { Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reanalyzeRepoAction } from "@/app/p/[projectId]/admin/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";

export function ReanalyzeButton({ projectId, disabled }: { projectId: string; disabled?: boolean }) {
  const { execute, pending } = useTicketAction();
  return (
    <Button
      type="button"
      variant="outline"
      disabled={pending || disabled}
      onClick={() => void execute(() => reanalyzeRepoAction(projectId), { success: "다시 분석을 시작했어요." })}
    >
      {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <RefreshCw aria-hidden="true" />}
      다시 분석
    </Button>
  );
}
