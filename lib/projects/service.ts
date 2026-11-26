import { randomBytes, randomUUID } from "node:crypto";
import { and, eq, inArray, notInArray, or, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  domainDocs,
  groupMembers,
  groups,
  invitation,
  jobs,
  member,
  organization,
  projects,
  requiredFields,
  ticketEvents,
  ticketSubscriptions,
  tickets,
  user,
  type AiProvider,
} from "@/lib/db/schema";
import type { Category, TicketStatus } from "@/lib/db/schema/tickets";
import { DEFAULT_REQUIRED_FIELDS } from "@/lib/agents/interview";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { encrypt } from "@/lib/crypto";
import { enqueue } from "@/lib/jobs/queue";
import { parseRepoUrl } from "@/lib/repo/sources/github";
import { AI_PROVIDERS, normalizeHex } from "@/lib/theme/accent";
import { isMemberRole, type MemberRole } from "@/lib/auth-roles";

export type Project = typeof projects.$inferSelect;

/** 사용자에게 그대로 보여줘도 되는 한국어 메시지를 담은 입력·규칙 위반. */
export class ProjectRuleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectRuleError";
  }
}

export const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const CATEGORIES = Object.keys(DEFAULT_REQUIRED_FIELDS) as Category[];

/** 화면에서 받은 GitHub 주소를 `https://github.com/owner/repo`로 맞춘다. 지원하지 않는 형식이면 규칙 위반. */
export function normalizeRepoUrl(input: string): string {
  try {
    const { owner, repo } = parseRepoUrl(input);
    return `https://github.com/${owner}/${repo}`;
  } catch {
    throw new ProjectRuleError("GitHub 주소를 확인해 주세요. 예: https://github.com/owner/repo");
  }
}

export type CreateProjectInput = {
  name: string;
  repoUrl: string;
  githubToken?: string | null;
  creatorId: string;
  defaultProvider?: AiProvider;
};

/**
 * 프로젝트(= Better Auth 조직)를 만든다. 만든 사람이 lead다.
 * 조직·멤버·프로젝트·필요 정보 기본값은 한 트랜잭션, 그 뒤 기본 프로필 5역할과 `repo.analyze` 작업.
 * `isDemo`는 항상 false(시드만 true). 조직 테이블은 Better Auth 스키마 그대로 쓴다(수락은 조직 플러그인이 처리).
 */
export async function createProject(db: Db, input: CreateProjectInput): Promise<Project> {
  const name = input.name.trim();
  if (!name) throw new ProjectRuleError("프로젝트 이름을 적어 주세요.");
  const repoUrl = normalizeRepoUrl(input.repoUrl);
  const provider = input.defaultProvider ?? "anthropic";
  if (!AI_PROVIDERS.includes(provider)) throw new ProjectRuleError("AI 제공자를 확인해 주세요.");
  const token = input.githubToken?.trim();

  const project = await db.transaction(async (tx) => {
    const orgId = randomUUID();
    const now = new Date();
    await tx.insert(organization).values({ id: orgId, name, slug: `proj-${randomBytes(6).toString("hex")}`, createdAt: now });
    await tx.insert(member).values({ id: randomUUID(), organizationId: orgId, userId: input.creatorId, role: "lead", createdAt: now });
    const [p] = await tx
      .insert(projects)
      .values({
        organizationId: orgId,
        name,
        repoUrl,
        githubTokenEnc: token ? encrypt(token) : null,
        defaultProvider: provider,
        isDemo: false,
      })
      .returning();
    await tx
      .insert(requiredFields)
      .values(CATEGORIES.map((category) => ({ projectId: p.id, category, items: DEFAULT_REQUIRED_FIELDS[category] })));
    return p;
  });

  try {
    await ensureDefaultProfiles(db, project.id, input.creatorId);
    await enqueue(db, "repo.analyze", { projectId: project.id });
  } catch (err) {
    // 반쯤 만들어진 프로젝트를 남기지 않는다(조직을 지우면 나머지는 cascade).
    await db.delete(organization).where(eq(organization.id, project.organizationId));
    throw err;
  }
  return project;
}

async function orgIdOf(db: Db, projectId: string): Promise<string> {
  const [p] = await db.select({ organizationId: projects.organizationId }).from(projects).where(eq(projects.id, projectId));
  if (!p) throw new ProjectRuleError("프로젝트를 찾을 수 없어요.");
  return p.organizationId;
}

export type InviteInput = { projectId: string; email: string; role: MemberRole; inviterId: string };

/** 초대를 만든다. 링크는 `/invite/<id>`. 같은 이메일의 대기 중 초대는 역할·기한만 새로 하고 같은 링크를 쓴다. */
export async function inviteMember(db: Db, input: InviteInput): Promise<{ invitationId: string; path: string }> {
  const email = input.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ProjectRuleError("이메일 주소를 확인해 주세요.");
  if (!isMemberRole(input.role)) throw new ProjectRuleError("역할을 확인해 주세요.");
  const organizationId = await orgIdOf(db, input.projectId);

  const [already] = await db
    .select({ id: member.id })
    .from(member)
    .innerJoin(user, eq(user.id, member.userId))
    .where(and(eq(member.organizationId, organizationId), sql`lower(${user.email}) = ${email}`))
    .limit(1);
  if (already) throw new ProjectRuleError("이미 이 프로젝트의 멤버예요.");

  const expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  const [pending] = await db
    .select({ id: invitation.id })
    .from(invitation)
    .where(and(eq(invitation.organizationId, organizationId), sql`lower(${invitation.email}) = ${email}`, eq(invitation.status, "pending")))
    .limit(1);
  if (pending) {
    await db.update(invitation).set({ role: input.role, expiresAt, inviterId: input.inviterId }).where(eq(invitation.id, pending.id));
    return { invitationId: pending.id, path: `/invite/${pending.id}` };
  }
  const id = randomUUID();
  await db.insert(invitation).values({ id, organizationId, email, role: input.role, status: "pending", expiresAt, inviterId: input.inviterId });
  return { invitationId: id, path: `/invite/${id}` };
}

/** 대기 중인 초대를 취소한다. 이 프로젝트의 초대가 아니면 아무것도 하지 않는다. */
export async function cancelInvitation(db: Db, projectId: string, invitationId: string): Promise<void> {
  const organizationId = await orgIdOf(db, projectId);
  await db
    .update(invitation)
    .set({ status: "canceled" })
    .where(and(eq(invitation.id, invitationId), eq(invitation.organizationId, organizationId), eq(invitation.status, "pending")));
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];

/** 마지막 lead를 지키기 위해 이 조직의 lead 행을 잠그고 수를 센다. */
async function lockedLeadCount(tx: Tx, organizationId: string): Promise<number> {
  const rows = await tx
    .select({ id: member.id })
    .from(member)
    .where(and(eq(member.organizationId, organizationId), eq(member.role, "lead")))
    .for("update");
  return rows.length;
}

/**
 * 이 사람이 대상이거나 담당 중인 티켓을 리드 큐로 옮긴다(대상·담당 비움, 진행 중이던 건 queued).
 * 종결·철회된 티켓은 건드리지 않는다. 티켓마다 이벤트 하나를 남긴다.
 */
async function releaseTicketsOf(tx: Tx, projectId: string, userId: string, eventType: string, reason: string): Promise<void> {
  const rows = await tx
    .select({ id: tickets.id, status: tickets.status, targetUserId: tickets.targetUserId, assigneeId: tickets.assigneeId })
    .from(tickets)
    .where(
      and(
        eq(tickets.projectId, projectId),
        or(eq(tickets.targetUserId, userId), eq(tickets.assigneeId, userId)),
        notInArray(tickets.status, ["closed", "withdrawn_ai_resolved"] as TicketStatus[]),
      ),
    );
  const BACK_TO_QUEUE: TicketStatus[] = ["assigned", "in_progress", "on_hold"];
  for (const t of rows) {
    const toQueue = BACK_TO_QUEUE.includes(t.status);
    const status: TicketStatus = toQueue ? "queued" : t.status;
    await tx
      .update(tickets)
      .set({
        targetUserId: null,
        assigneeId: null,
        // 사람 대상이던 queued는 그대로 queued(리드 큐), 처리 중이던 건 처음 상태인 queued로.
        status,
        version: sql`${tickets.version} + 1`,
        updatedAt: new Date(),
      })
      .where(eq(tickets.id, t.id));
    await tx.insert(ticketEvents).values({
      ticketId: t.id,
      actorId: null,
      actorKind: "system",
      type: eventType,
      from: { status: t.status, targetUserId: t.targetUserId, assigneeId: t.assigneeId },
      to: { status, targetUserId: null, assigneeId: null },
      reason,
    });
  }
}

async function leaveProjectWork(tx: Tx, projectId: string, userId: string): Promise<void> {
  const ticketIds = tx.select({ id: tickets.id }).from(tickets).where(eq(tickets.projectId, projectId));
  await tx.delete(ticketSubscriptions).where(and(eq(ticketSubscriptions.userId, userId), inArray(ticketSubscriptions.ticketId, ticketIds)));
  const groupIds = tx.select({ id: groups.id }).from(groups).where(eq(groups.projectId, projectId));
  await tx.delete(groupMembers).where(and(eq(groupMembers.userId, userId), inArray(groupMembers.groupId, groupIds)));
}

export type ChangeRoleInput = { projectId: string; userId: string; role: MemberRole };

/**
 * 역할을 바꾼다. 마지막 lead는 강등할 수 없다.
 * 요청자로 바꾸면 그룹에서 빼고, 대상·담당이던 티켓은 리드 큐로 옮긴다(요청자는 대상이 될 수 없다).
 */
export async function changeMemberRole(db: Db, input: ChangeRoleInput): Promise<void> {
  if (!isMemberRole(input.role)) throw new ProjectRuleError("역할을 확인해 주세요.");
  const organizationId = await orgIdOf(db, input.projectId);
  await db.transaction(async (tx) => {
    const leads = await lockedLeadCount(tx, organizationId);
    const [m] = await tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, input.userId)));
    if (!m) throw new ProjectRuleError("이 프로젝트의 멤버가 아니에요.");
    if (m.role === input.role) return;
    if (m.role === "lead" && leads <= 1) throw new ProjectRuleError("마지막 리드는 역할을 바꿀 수 없어요. 먼저 다른 리드를 지정해 주세요.");
    await tx.update(member).set({ role: input.role }).where(eq(member.id, m.id));
    if (input.role === "requester") {
      await releaseTicketsOf(tx, input.projectId, input.userId, "member_role_changed", "요청자로 바뀌어 대상·담당에서 빠졌어요. 리드 큐로 옮겼어요.");
      await leaveProjectWork(tx, input.projectId, input.userId);
    }
  });
}

/** 멤버를 내보낸다. 마지막 lead는 내보낼 수 없다. 대상·담당 티켓은 리드 큐로(이벤트 `member_removed`), 구독·그룹 소속은 지운다. */
export async function removeMember(db: Db, input: { projectId: string; userId: string }): Promise<void> {
  const organizationId = await orgIdOf(db, input.projectId);
  await db.transaction(async (tx) => {
    const leads = await lockedLeadCount(tx, organizationId);
    const [m] = await tx
      .select({ id: member.id, role: member.role })
      .from(member)
      .where(and(eq(member.organizationId, organizationId), eq(member.userId, input.userId)));
    if (!m) throw new ProjectRuleError("이 프로젝트의 멤버가 아니에요.");
    if (m.role === "lead" && leads <= 1) throw new ProjectRuleError("마지막 리드는 내보낼 수 없어요. 먼저 다른 리드를 지정해 주세요.");
    await releaseTicketsOf(tx, input.projectId, input.userId, "member_removed", "프로젝트에서 빠져 대상·담당에서 제외됐어요. 리드 큐로 옮겼어요.");
    await leaveProjectWork(tx, input.projectId, input.userId);
    await tx.delete(member).where(eq(member.id, m.id));
  });
}

export const DOMAIN_TITLE_MAX = 80;
export const DOMAIN_BODY_MAX = 50_000;

/** 도메인 지식 항목을 제목으로 만들거나 고친다(제목은 프로젝트 안에서 유일하게 다룬다). */
export async function upsertDomainDoc(
  db: Db,
  input: { projectId: string; title: string; body: string; editorId: string },
): Promise<typeof domainDocs.$inferSelect> {
  const title = input.title.trim();
  if (!title) throw new ProjectRuleError("제목을 적어 주세요.");
  if (title.length > DOMAIN_TITLE_MAX) throw new ProjectRuleError(`제목은 ${DOMAIN_TITLE_MAX}자 이하로 적어 주세요.`);
  if (input.body.length > DOMAIN_BODY_MAX) throw new ProjectRuleError("내용이 너무 길어요.");
  const values = { body: input.body, updatedAt: new Date(), updatedBy: input.editorId };
  const [existing] = await db
    .select({ id: domainDocs.id })
    .from(domainDocs)
    .where(and(eq(domainDocs.projectId, input.projectId), eq(domainDocs.title, title)));
  if (existing) {
    const [row] = await db.update(domainDocs).set(values).where(eq(domainDocs.id, existing.id)).returning();
    return row;
  }
  const [row] = await db.insert(domainDocs).values({ projectId: input.projectId, title, ...values }).returning();
  return row;
}

export async function deleteDomainDoc(db: Db, projectId: string, docId: string): Promise<void> {
  await db.delete(domainDocs).where(and(eq(domainDocs.id, docId), eq(domainDocs.projectId, projectId)));
}

/** 기본 AI 제공자. 이미 만든 프로필의 모델은 바꾸지 않는다(기본 강조색만 따라간다). */
export async function setDefaultProvider(db: Db, projectId: string, provider: AiProvider): Promise<void> {
  if (!AI_PROVIDERS.includes(provider)) throw new ProjectRuleError("AI 제공자를 확인해 주세요.");
  await db.update(projects).set({ defaultProvider: provider }).where(eq(projects.id, projectId));
}

/** 프로젝트 기본 강조색. `#RRGGBB`만 저장하고(화면 스타일에 들어가므로) null이면 제공자 색으로 돌아간다. */
export async function setAccentDefault(db: Db, projectId: string, hex: string | null): Promise<void> {
  let value: string | null = null;
  if (hex !== null) {
    value = normalizeHex(hex);
    if (!value) throw new ProjectRuleError("#RRGGBB 형식으로 입력해 주세요.");
  }
  await db.update(projects).set({ accentDefault: value }).where(eq(projects.id, projectId));
}

/** GitHub 토큰을 암호화해 저장하거나(null이면) 지운다. 평문은 어디에도 남기지 않는다. */
export async function setGithubToken(db: Db, projectId: string, token: string | null): Promise<void> {
  const t = token?.trim();
  await db
    .update(projects)
    .set({ githubTokenEnc: t ? encrypt(t) : null })
    .where(eq(projects.id, projectId));
}

/** 레포 분석이 이미 대기·진행 중인지. */
export async function hasActiveRepoJob(db: Db, projectId: string): Promise<boolean> {
  const rows = await db
    .select({ id: jobs.id })
    .from(jobs)
    .where(and(eq(jobs.kind, "repo.analyze"), inArray(jobs.status, ["pending", "running"]), sql`${jobs.payload}->>'projectId' = ${projectId}`))
    .limit(1);
  return rows.length > 0;
}

/** 다시 분석. 이미 대기·진행 중이면 새로 만들지 않는다. 만들었으면 true. */
export async function requestReanalysis(db: Db, projectId: string): Promise<boolean> {
  if (await hasActiveRepoJob(db, projectId)) return false;
  await enqueue(db, "repo.analyze", { projectId });
  return true;
}

