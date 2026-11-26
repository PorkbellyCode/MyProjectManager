import Link from "next/link";
import type { TicketRefView } from "@/lib/tickets/detail";
import { STATUS_LABEL, ticketRef } from "@/lib/tickets/labels";
import { StatusDot } from "./status-badge";

/** 다른 티켓으로 가는 링크: 번호(고정폭) · 제목 · 상태. */
export function TicketChip({ projectId, t }: { projectId: string; t: Pick<TicketRefView, "id" | "number" | "title"> & { status?: TicketRefView["status"] } }) {
  return (
    <Link
      href={`/p/${projectId}/tickets/${t.id}`}
      className="inline-flex max-w-full items-center gap-2 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-text no-underline transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-faint/60"
    >
      <span className="font-mono text-faint">{ticketRef(t.number)}</span>
      <span className="min-w-0 truncate font-medium">{t.title}</span>
      {t.status && (
        <span className="inline-flex shrink-0 items-center gap-1.5 text-muted-text">
          <StatusDot status={t.status} />
          {STATUS_LABEL[t.status]}
        </span>
      )}
    </Link>
  );
}
