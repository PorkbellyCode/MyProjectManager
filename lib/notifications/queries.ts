import { and, count, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { notifications, projects, ticketEvents, tickets, user } from "@/lib/db/schema";

/** 읽지 않은 알림 수. 상단 바 배지가 30초마다 가져간다. */
export async function countUnread(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}

export type NotificationView = {
  id: string;
  kind: string;
  createdAt: Date;
  readAt: Date | null;
  reason: string | null;
  actorName: string | null;
  ticket: { id: string; number: number; title: string; projectId: string; projectName: string };
};

export const NOTIFICATION_LIMIT = 50;

/** 내 알림 최근 50건(새것부터). 다른 사람의 알림은 볼 수 없다(userId로만 거른다). */
export async function listNotifications(db: Db, userId: string, limit = NOTIFICATION_LIMIT): Promise<NotificationView[]> {
  const rows = await db
    .select({
      id: notifications.id,
      kind: notifications.kind,
      createdAt: notifications.createdAt,
      readAt: notifications.readAt,
      reason: ticketEvents.reason,
      actorName: user.name,
      ticketId: tickets.id,
      number: tickets.number,
      title: tickets.title,
      projectId: projects.id,
      projectName: projects.name,
    })
    .from(notifications)
    .innerJoin(tickets, eq(tickets.id, notifications.ticketId))
    .innerJoin(projects, eq(projects.id, tickets.projectId))
    .innerJoin(ticketEvents, eq(ticketEvents.id, notifications.eventId))
    .leftJoin(user, eq(user.id, ticketEvents.actorId))
    .where(eq(notifications.userId, userId))
    .orderBy(desc(notifications.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    createdAt: r.createdAt,
    readAt: r.readAt,
    reason: r.reason,
    actorName: r.actorName,
    ticket: { id: r.ticketId, number: r.number, title: r.title, projectId: r.projectId, projectName: r.projectName },
  }));
}

/** 내 알림을 읽음으로 표시한다. ids가 없으면 전부. 다른 사람의 알림 id는 무시된다. 바뀐 개수를 돌려준다. */
export async function markNotificationsRead(db: Db, userId: string, ids?: readonly string[]): Promise<number> {
  if (ids && ids.length === 0) return 0;
  const rows = await db
    .update(notifications)
    .set({ readAt: new Date() })
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), ids ? inArray(notifications.id, [...ids]) : undefined))
    .returning({ id: notifications.id });
  return rows.length;
}
