import type { TicketStatus } from "@/lib/db/schema/tickets";
import { STATUS_DOT, STATUS_LABEL } from "@/lib/tickets/labels";
import { cn } from "@/lib/utils";

/** 상태는 색 점 + 글자(색만으로 구분하지 않는다). 점 색은 0.3초에 걸쳐 바뀐다. */
export function StatusDot({ status, className }: { status: TicketStatus; className?: string }) {
  return <span aria-hidden className={cn("status-dot inline-block size-[7px] shrink-0 rounded-full", className)} style={{ backgroundColor: STATUS_DOT[status] }} />;
}

export function StatusText({ status, className }: { status: TicketStatus; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-1.5", className)}>
      <StatusDot status={status} />
      {STATUS_LABEL[status]}
    </span>
  );
}
