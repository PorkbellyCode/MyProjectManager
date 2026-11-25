import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getMembership } from "@/lib/access";
import { groupMembers, groups, ticketEvents, tickets } from "@/lib/db/schema";
import { InvalidTargetError } from "@/lib/tickets/targets";

export type Group = typeof groups.$inferSelect;

/** 이름(프로젝트 안에서 유일)으로 만들거나 갱신한다. */
export async function upsertGroup(
  db: Db,
  input: { projectId: string; name: string; scopeDescription: string; repoTags: string[] },
): Promise<Group> {
  const [g] = await db
    .insert(groups)
    .values(input)
    .onConflictDoUpdate({
      target: [groups.projectId, groups.name],
      set: { scopeDescription: input.scopeDescription, repoTags: input.repoTags },
    })
    .returning();
  return g;
}

/** 그룹원 전체를 교체한다. 이 프로젝트의 lead/developer만 넣을 수 있고 요청자·비멤버는 거부한다. */
export async function setGroupMembers(db: Db, groupId: string, userIds: string[]): Promise<void> {
  const [g] = await db.select().from(groups).where(eq(groups.id, groupId));
  if (!g) throw new InvalidTargetError("그룹을 찾을 수 없어요");
  const unique = [...new Set(userIds)];
  for (const userId of unique) {
    const m = await getMembership(db, g.projectId, userId);
    if (!m || m.role === "requester") throw new InvalidTargetError();
  }
  await db.transaction(async (tx) => {
    await tx.delete(groupMembers).where(eq(groupMembers.groupId, groupId));
    if (unique.length) await tx.insert(groupMembers).values(unique.map((userId) => ({ groupId, userId })));
  });
}

/**
 * 그룹을 지운다. 이 그룹 큐에서 기다리는(queued) 티켓은 리드 큐로 옮기고 `group_deleted` 이벤트를 남긴다.
 * 이미 담당자가 있는 티켓은 그대로 두고(FK가 대상 칸만 비운다), 알림은 보내지 않는다.
 */
export async function deleteGroup(db: Db, groupId: string, actorId?: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [g] = await tx.select().from(groups).where(eq(groups.id, groupId));
    if (!g) return;
    const waiting = await tx
      .select({ id: tickets.id })
      .from(tickets)
      .where(and(eq(tickets.targetGroupId, groupId), eq(tickets.status, "queued"), isNull(tickets.assigneeId)));
    const ids = waiting.map((t) => t.id);
    if (ids.length) {
      await tx
        .update(tickets)
        .set({ targetGroupId: null, targetUserId: null, version: sql`${tickets.version} + 1`, updatedAt: new Date() })
        .where(inArray(tickets.id, ids));
      await tx.insert(ticketEvents).values(
        ids.map((ticketId) => ({
          ticketId,
          actorId: actorId ?? null,
          actorKind: actorId ? ("user" as const) : ("system" as const),
          type: "group_deleted",
          from: { targetGroupId: groupId },
          to: { targetGroupId: null },
          reason: `그룹 "${g.name}"이(가) 삭제되어 리드 큐로 옮겼어요.`,
        })),
      );
    }
    await tx.delete(groups).where(eq(groups.id, groupId));
  });
}
