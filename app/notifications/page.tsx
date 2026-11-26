import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PageFallback, PageFrame } from "@/components/app-shell/page-frame";
import { NotificationList, type NotificationItem } from "@/components/notifications/notification-list";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listNotifications, NOTIFICATION_LIMIT } from "@/lib/notifications/queries";

export const metadata = { title: "알림" };

export default function NotificationsPage() {
  return (
    <Suspense fallback={<PageFallback />}>
      <Notifications />
    </Suspense>
  );
}

const fmt = new Intl.DateTimeFormat("ko-KR", { month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

async function Notifications() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const rows = await listNotifications(db, user.id);
  const items: NotificationItem[] = rows.map((n) => ({
    id: n.id,
    kind: n.kind,
    at: n.createdAt.toISOString(),
    time: fmt.format(n.createdAt),
    read: n.readAt !== null,
    reason: n.reason,
    actorName: n.actorName,
    ticket: n.ticket,
  }));
  const showProject = new Set(items.map((i) => i.ticket.projectId)).size > 1;
  return (
    <PageFrame title="알림" description={`내가 요청했거나 맡은 티켓의 변화를 최근 ${NOTIFICATION_LIMIT}건까지 모아 보여줘요.`}>
      <NotificationList items={items} showProject={showProject} />
    </PageFrame>
  );
}
