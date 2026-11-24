import { and, eq } from "drizzle-orm";
import { notFound } from "next/navigation";
import type { Db } from "@/lib/db";
import { member, projects } from "@/lib/db/schema";
import { isMemberRole, type MemberRole } from "@/lib/auth-roles";

export type { MemberRole };

export class ForbiddenError extends Error {
  constructor(message = "이 작업을 할 권한이 없어요.") {
    super(message);
    this.name = "ForbiddenError";
  }
}

/** projectId(projects.id) → 조직 멤버십. 멤버가 아니면 null. */
export async function getMembership(
  db: Db,
  projectId: string,
  userId: string,
): Promise<{ role: MemberRole; joinedAt: Date } | null> {
  const [row] = await db
    .select({ role: member.role, joinedAt: member.createdAt })
    .from(projects)
    .innerJoin(member, eq(member.organizationId, projects.organizationId))
    .where(and(eq(projects.id, projectId), eq(member.userId, userId)))
    .limit(1);
  if (!row || !isMemberRole(row.role)) return null;
  return { role: row.role, joinedAt: row.joinedAt };
}

/** 비멤버는 404(notFound), 역할 불일치는 ForbiddenError. */
export async function requireMember(
  db: Db,
  projectId: string,
  userId: string,
  roles?: MemberRole[],
): Promise<{ role: MemberRole }> {
  const m = await getMembership(db, projectId, userId);
  if (!m) notFound();
  if (roles && !roles.includes(m.role)) throw new ForbiddenError();
  return { role: m.role };
}
