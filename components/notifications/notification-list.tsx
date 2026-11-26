"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { CheckCheck, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { markNotificationsReadAction } from "@/app/p/[projectId]/tickets/actions";
import { notificationLabel, NOTIFICATIONS_CHANGED } from "@/lib/notifications/labels";
import { ticketRef } from "@/lib/tickets/labels";
import { listStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";

export type NotificationItem = {
  id: string;
  kind: string;
  at: string;
  time: string;
  read: boolean;
  reason: string | null;
  actorName: string | null;
  ticket: { id: string; number: number; title: string; projectId: string; projectName: string };
};

const notifyBadge = () => window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));

/**
 * 최근 알림 목록. 항목을 누르면 먼저 읽음으로 표시하고(서버) 그 티켓으로 간다.
 * 링크라서 새 탭 열기·키보드 이동이 그대로 되고, 읽음 처리가 실패해도 이동은 막지 않는다.
 */
export function NotificationList({ items, showProject }: { items: NotificationItem[]; showProject: boolean }) {
  const router = useRouter();
  const [read, setRead] = useState<Set<string>>(() => new Set(items.filter((i) => i.read).map((i) => i.id)));
  const [pendingAll, startAll] = useTransition();
  const unread = items.filter((i) => !read.has(i.id)).length;

  async function open(e: React.MouseEvent<HTMLAnchorElement>, item: NotificationItem, href: string) {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    if (!read.has(item.id)) {
      setRead((s) => new Set(s).add(item.id));
      await markNotificationsReadAction({ ids: [item.id] }).catch(() => null);
      notifyBadge();
    }
    router.push(href);
  }

  function readAll() {
    startAll(async () => {
      const r = await markNotificationsReadAction({}).catch(() => null);
      if (!r || !r.ok) {
        toast.error("읽음 처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요.");
        return;
      }
      setRead(new Set(items.map((i) => i.id)));
      notifyBadge();
      router.refresh();
    });
  }

  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line bg-surface px-6 py-16 text-center">
        <p className="text-[15px] font-medium">아직 알림이 없어요</p>
        <p className="max-w-sm text-sm text-muted-text">요청했거나 맡은 티켓이 바뀌면 여기에 모여요.</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center justify-between gap-4">
        <p className="text-sm text-muted-text" aria-live="polite">
          {unread > 0 ? `읽지 않은 알림 ${unread}건` : "모두 읽었어요"}
        </p>
        <Button type="button" variant="outline" className="rounded-[10px]" disabled={unread === 0 || pendingAll} onClick={readAll}>
          {pendingAll ? <Loader2 className="animate-spin" aria-hidden /> : <CheckCheck aria-hidden />}
          모두 읽음
        </Button>
      </div>
      <ul className="overflow-hidden rounded-[14px] border border-line bg-surface">
        {items.map((n, i) => {
          const isRead = read.has(n.id);
          const href = `/p/${n.ticket.projectId}/tickets/${n.ticket.id}`;
          return (
            <li key={n.id} className="rise border-b border-line last:border-b-0" style={listStagger(i, 0.03)}>
              <a
                href={href}
                onClick={(e) => void open(e, n, href)}
                className={cn(
                  "flex items-start gap-4 px-6 py-4 text-text no-underline transition-colors duration-150 hover:bg-sunken/60 focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-inset focus-visible:ring-ring/40",
                )}
              >
                <span className="flex h-6 w-2.5 shrink-0 items-center justify-center">
                  <span aria-hidden className={cn("size-2 rounded-full transition-opacity duration-300", isRead ? "opacity-0" : "bg-brand")} />
                </span>
                <span className="flex min-w-0 flex-1 flex-col gap-1">
                  <span className={cn("text-[15px] leading-[1.5]", isRead ? "text-muted-text" : "font-medium")}>{notificationLabel(n.kind)}</span>
                  <span className="flex min-w-0 items-baseline gap-2 text-sm">
                    <span className="shrink-0 font-mono text-[13px] text-faint">{ticketRef(n.ticket.number)}</span>
                    <span className="min-w-0 truncate">{n.ticket.title}</span>
                  </span>
                  {(n.actorName || n.reason || showProject) && (
                    <span className="flex flex-wrap items-center gap-x-2 text-[13px] text-faint">
                      {showProject && <span>{n.ticket.projectName}</span>}
                      {n.actorName && <span>{n.actorName}</span>}
                      {n.reason && <span className="min-w-0 truncate text-muted-text">“{n.reason}”</span>}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <time dateTime={n.at} className="font-mono text-xs text-faint">
                    {n.time}
                  </time>
                  {!isRead && <span className="text-[11px] text-faint">읽지 않음</span>}
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
