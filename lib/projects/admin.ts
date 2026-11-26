import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  domainDocs,
  groupMembers,
  groups,
  invitation,
  jobs,
  member,
  projects,
  user,
  type AiProvider,
} from "@/lib/db/schema";
import { isMemberRole, type MemberRole } from "@/lib/auth-roles";
import { AGENT_ROLES, ensureDefaultProfiles, getActiveProfile, listProfileVersions, type AgentProfile, type AgentRole, type ProfileVersionRow } from "@/lib/agents/profiles";
import { getLatestSnapshot, type RepoSnapshot } from "@/lib/agents/repo-analyst";

export type ProjectSummary = {
  id: string;
  name: string;
  repoUrl: string;
  isDemo: boolean;
  defaultProvider: AiProvider;
  accentDefault: string | null;
  hasGithubToken: boolean;
};

export async function getProjectSummary(db: Db, projectId: string): Promise<ProjectSummary | null> {
  const [p] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!p) return null;
  return {
    id: p.id,
    name: p.name,
    repoUrl: p.repoUrl,
    isDemo: p.isDemo,
    defaultProvider: p.defaultProvider,
    accentDefault: p.accentDefault,
    hasGithubToken: !!p.githubTokenEnc,
  };
}

export type RepoPageData = {
  project: ProjectSummary;
  groups: { id: string; name: string }[];
  /** 가장 최근에 성공한 분석 */
  good: RepoSnapshot | null;
  /** 가장 최근 분석(성공이든 실패든) */
  latest: RepoSnapshot | null;
  /** 분석 작업이 대기·진행 중 */
  analyzing: boolean;
};

export async function getRepoPageData(db: Db, projectId: string): Promise<RepoPageData | null> {
  const project = await getProjectSummary(db, projectId);
  if (!project) return null;
  const [good, latest, gs, active] = await Promise.all([
    getLatestSnapshot(db, projectId, { status: "ok" }),
    getLatestSnapshot(db, projectId),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.name)),
    db
      .select({ id: jobs.id })
      .from(jobs)
      .where(and(eq(jobs.kind, "repo.analyze"), inArray(jobs.status, ["pending", "running"]), sql`${jobs.payload}->>'projectId' = ${projectId}`))
      .limit(1),
  ]);
  return { project, groups: gs, good, latest, analyzing: active.length > 0 };
}

export type AdminMember = { userId: string; name: string; email: string; role: MemberRole };
export type AdminInvitation = { id: string; email: string; role: MemberRole; expiresAt: Date };
export type AdminGroup = { id: string; name: string; scopeDescription: string; repoTags: string[]; memberIds: string[] };
export type AdminAgent = { role: AgentRole; active: AgentProfile; versions: ProfileVersionRow[] };

export type AdminData = {
  project: ProjectSummary;
  members: AdminMember[];
  invitations: AdminInvitation[];
  groups: AdminGroup[];
  docs: { id: string; title: string; body: string; updatedAt: Date }[];
  agents: AdminAgent[];
};

/** 관리자 화면에 필요한 값 전부. 호출하는 쪽이 lead인지 확인한다. */
export async function getAdminData(db: Db, projectId: string, editorId: string): Promise<AdminData | null> {
  const project = await getProjectSummary(db, projectId);
  if (!project) return null;
  // 시드나 이전 방식으로 만든 프로젝트에 프로필이 없으면 기본값으로 채운다(있는 역할은 건드리지 않는다).
  await ensureDefaultProfiles(db, projectId, editorId);
  const [p] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId));
  const [memberRows, inviteRows, groupRows, gmRows, docRows, agents] = await Promise.all([
    db
      .select({ userId: user.id, name: user.name, email: user.email, role: member.role })
      .from(member)
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(member.organizationId, p.organizationId))
      .orderBy(asc(member.createdAt), asc(user.name)),
    db
      .select()
      .from(invitation)
      .where(and(eq(invitation.organizationId, p.organizationId), eq(invitation.status, "pending")))
      .orderBy(desc(invitation.createdAt)),
    db.select().from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.name)),
    db
      .select({ groupId: groupMembers.groupId, userId: groupMembers.userId })
      .from(groupMembers)
      .innerJoin(groups, eq(groups.id, groupMembers.groupId))
      .where(eq(groups.projectId, projectId)),
    db.select().from(domainDocs).where(eq(domainDocs.projectId, projectId)).orderBy(asc(domainDocs.title)),
    Promise.all(
      AGENT_ROLES.map(async (role): Promise<AdminAgent> => ({
        role,
        active: await getActiveProfile(db, projectId, role),
        versions: await listProfileVersions(db, projectId, role),
      })),
    ),
  ]);
  return {
    project,
    members: memberRows.flatMap((m) => (isMemberRole(m.role) ? [{ ...m, role: m.role }] : [])),
    invitations: inviteRows.flatMap((i) =>
      i.role && isMemberRole(i.role) && i.expiresAt.getTime() > Date.now() ? [{ id: i.id, email: i.email, role: i.role, expiresAt: i.expiresAt }] : [],
    ),
    groups: groupRows.map((g) => ({
      id: g.id,
      name: g.name,
      scopeDescription: g.scopeDescription,
      repoTags: g.repoTags,
      memberIds: gmRows.filter((r) => r.groupId === g.id).map((r) => r.userId),
    })),
    docs: docRows.map((d) => ({ id: d.id, title: d.title, body: d.body, updatedAt: d.updatedAt })),
    agents,
  };
}
