import { desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { member, projects, type AiProvider } from "@/lib/db/schema";
import { isMemberRole, type MemberRole } from "@/lib/auth-roles";

export type UserProject = {
  id: string;
  name: string;
  role: MemberRole;
  defaultProvider: AiProvider;
  accentDefault: string | null;
};

/** 사용자가 속한 프로젝트(오래 전에 합류한 순서). */
export async function listUserProjects(db: Db, userId: string): Promise<UserProject[]> {
  const rows = await db
    .select({
      id: projects.id,
      name: projects.name,
      role: member.role,
      defaultProvider: projects.defaultProvider,
      accentDefault: projects.accentDefault,
    })
    .from(member)
    .innerJoin(projects, eq(projects.organizationId, member.organizationId))
    .where(eq(member.userId, userId))
    .orderBy(member.createdAt, desc(projects.createdAt));
  return rows.flatMap(({ role, ...p }) => (isMemberRole(role) ? [{ ...p, role }] : []));
}
