import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  groupMembers,
  member,
  notifications,
  projects,
  ticketSubscriptions,
  type tickets,
} from "@/lib/db/schema";

type Ticket = typeof tickets.$inferSelect;

/** 알림을 만들 때 필요한 이벤트의 최소 모양(ticket_events 행의 일부). */
export type NotifiableEvent = { id: string; type: string; actorId: string | null };

const subscribers = async (tx: Db, ticketId: string) =>
  (await tx.select({ id: ticketSubscriptions.userId }).from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, ticketId))).map(
    (r) => r.id,
  );

const leads = async (tx: Db, projectId: string) =>
  (
    await tx
      .select({ id: member.userId })
      .from(projects)
      .innerJoin(member, eq(member.organizationId, projects.organizationId))
      .where(and(eq(projects.id, projectId), eq(member.role, "lead")))
  ).map((r) => r.id);

const groupUsers = async (tx: Db, groupId: string) =>
  (await tx.select({ id: groupMembers.userId }).from(groupMembers).where(eq(groupMembers.groupId, groupId))).map((r) => r.id);

/** 새 배치(대상)의 받는 사람: 사람 → 그 사람, 그룹 큐 → 그룹원 전원, 리드 큐 → lead 전원. */
async function placementRecipients(tx: Db, t: Ticket): Promise<string[]> {
  if (t.targetUserId) return [t.targetUserId];
  if (t.targetGroupId) return groupUsers(tx, t.targetGroupId);
  return leads(tx, t.projectId);
}

async function recipientsFor(tx: Db, event: NotifiableEvent, t: Ticket): Promise<string[]> {
  const nz = (...ids: (string | null)[]) => ids.filter((x): x is string => x !== null);
  switch (event.type) {
    case "stageReady":
    case "stageFailed":
    case "accept":
    case "claim":
    case "hold":
    case "resume":
      return [t.authorId];
    case "submit":
    case "assignTarget":
    case "transfer":
      return placementRecipients(tx, t);
    case "resolve":
      return [t.authorId, ...(await subscribers(tx, t.id))];
    case "reopen":
      return nz(t.assigneeId);
    case "close":
    case "commented":
      return [t.authorId, ...nz(t.assigneeId), ...(await subscribers(tx, t.id))];
    case "summary_edited":
      return nz(t.targetUserId ?? t.assigneeId);
    case "wont_do_proposed":
      return leads(tx, t.projectId);
    default:
      // created, urgency_changed, group_deleted, requestReview, withdraw, … → 알림 없음
      return [];
  }
}

/**
 * 이벤트에 대한 알림을 만든다. 행위자 본인은 항상 제외하고 사용자별로 한 번만 보낸다.
 * `tx`는 이벤트를 쓴 같은 트랜잭션이어야 한다. 만든 알림의 받는 사람 id들을 돌려준다.
 */
export async function emitNotifications(tx: Db, event: NotifiableEvent, ticket: Ticket): Promise<string[]> {
  const ids = [...new Set(await recipientsFor(tx, event, ticket))].filter((id) => id !== event.actorId);
  if (ids.length === 0) return [];
  await tx.insert(notifications).values(
    ids.map((userId) => ({ userId, ticketId: ticket.id, eventId: event.id, kind: event.type })),
  );
  return ids;
}
