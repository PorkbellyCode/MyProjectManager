import { and, eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { comments, member, projects, ticketSummaries, tickets, user } from "@/lib/db/schema";
import type { Category, Urgency } from "@/lib/db/schema/tickets";
import type { createAuth } from "@/lib/auth";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { addComment } from "@/lib/comments/service";
import { setGroupMembers, upsertGroup } from "@/lib/groups/service";
import { createProject, upsertDomainDoc } from "@/lib/projects/service";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";
import {
  DEMO_ACCOUNTS,
  DEMO_GROUPS,
  DEMO_PASSWORD,
  DEMO_PROJECT_NAME,
  DEMO_REPO_URL,
  SEED_PINNED_COMMIT,
  SEED_TICKET_TITLES,
  type DemoAccount,
} from "./seed-data";
import { splitHandover } from "./handover";

type Auth = ReturnType<typeof createAuth>;

export type SeedResult = { projectId: string; created: { users: number; tickets: number; project: boolean } };

type HistoricalTicket = {
  title: string;
  body: string;
  category: Category;
  urgency: Urgency;
  author: DemoAccount["key"];
  group: DemoAccount["key"];
  assignee: DemoAccount["key"];
  /** 처리자가 남기는 안내 댓글 */
  comment: string;
  /** 있으면 처리 완료(링크 포함) → 요청자 확인(종결)까지. 없으면 진행 중에서 멈춘다. */
  finish?: { linkedRefs: string[] };
};

/** 인수인계 문서에 남은 실제 이력을 바탕으로 한 과거 티켓. */
const HISTORY: HistoricalTicket[] = [
  {
    title: SEED_TICKET_TITLES.pinned,
    body: "메모에서 '이어가기'를 누르면 기록 날짜가 오늘로 옮겨져서, 어느 날 쓴 메모인지 헷갈려요. 계속 보이게만 해 주면 좋겠어요.",
    category: "improvement",
    urgency: "normal",
    author: "req",
    group: "fe",
    assignee: "fe",
    comment: "날짜를 옮기지 않고 계속 보이게만 하도록 목적을 좁혀 '고정하기'(pinned)로 바꿨어요. 기록 날짜는 그대로 남아요.",
    finish: { linkedRefs: [`commit:${SEED_PINNED_COMMIT}`] },
  },
  {
    title: SEED_TICKET_TITLES.restore,
    body: "실수로 요약을 지웠어요. 지운 요약을 되살릴 수 있나요?",
    category: "inquiry",
    urgency: "normal",
    author: "qa",
    group: "be",
    assignee: "be",
    comment: "지운 요약은 소프트 삭제라 30일 동안 보관된 뒤 정리돼요. 다만 화면에서 되살리는 기능은 아직 없어요.",
    finish: { linkedRefs: [] },
  },
  {
    title: SEED_TICKET_TITLES.limit,
    body: "요약을 하루에 몇 번까지 만들 수 있나요? 제한이 있다면 알고 싶어요.",
    category: "inquiry",
    urgency: "low",
    author: "req",
    group: "be",
    assignee: "be",
    comment: "하루 요약 상한은 코드에만 있고 기본값은 꺼져 있어요. 지금은 횟수 제한 없이 만들 수 있어요.",
    finish: { linkedRefs: [] },
  },
  {
    title: SEED_TICKET_TITLES.dup,
    body: "같은 작업을 여러 번 메모했더니 요약에 같은 줄이 두 번 나와요. 하나로 묶여야 하는 것 아닌가요?",
    category: "defect",
    urgency: "normal",
    author: "qa",
    group: "ai",
    assignee: "ai",
    comment: "요약 프롬프트의 '같은 작업은 하나로 묶기' 규칙이 긴 메모에서 빠지는지 확인하고 있어요.",
  },
];

async function ensureUser(db: Db, auth: Auth, a: DemoAccount): Promise<{ id: string; created: boolean }> {
  const [existing] = await db.select({ id: user.id }).from(user).where(eq(user.email, a.email));
  if (existing) return { id: existing.id, created: false };
  const res = await auth.api.signUpEmail({ body: { email: a.email, password: DEMO_PASSWORD, name: a.name } });
  return { id: res.user.id, created: true };
}

/**
 * 시연 데이터를 만든다. 몇 번 실행해도 결과가 같다(있는 것은 건드리지 않거나 같은 값으로 맞춘다).
 * 서비스 함수와 Better Auth 서버 API를 거친다(HTTP 조직 변경은 막혀 있어도 서버 호출은 된다).
 */
export async function seedDemo(db: Db, auth: Auth, opts: { handoverMarkdown: string; log?: (msg: string) => void }): Promise<SeedResult> {
  const log = opts.log ?? (() => {});
  const created = { users: 0, tickets: 0, project: false };

  // 1) 계정
  const ids = {} as Record<DemoAccount["key"], string>;
  for (const a of DEMO_ACCOUNTS) {
    const u = await ensureUser(db, auth, a);
    ids[a.key] = u.id;
    if (u.created) created.users++;
  }

  // 2) 프로젝트 (만든 사람이 lead). createProject는 기본 프로필과 repo.analyze 작업까지 만든다.
  let [project] = await db.select().from(projects).where(and(eq(projects.name, DEMO_PROJECT_NAME), eq(projects.repoUrl, DEMO_REPO_URL)));
  if (!project) {
    project = await createProject(db, { name: DEMO_PROJECT_NAME, repoUrl: DEMO_REPO_URL, creatorId: ids.lead, defaultProvider: "anthropic" });
    created.project = true;
  }
  if (!project.isDemo) {
    [project] = await db.update(projects).set({ isDemo: true }).where(eq(projects.id, project.id)).returning();
  }
  await ensureDefaultProfiles(db, project.id, ids.lead);

  // 3) 멤버
  for (const a of DEMO_ACCOUNTS) {
    const [m] = await db
      .select({ id: member.id })
      .from(member)
      .where(and(eq(member.organizationId, project.organizationId), eq(member.userId, ids[a.key])));
    if (!m) await auth.api.addMember({ body: { organizationId: project.organizationId, userId: ids[a.key], role: a.role } });
  }

  // 4) 그룹과 그룹원
  const groupIds = {} as Record<DemoAccount["key"], string>;
  for (const g of DEMO_GROUPS) {
    const row = await upsertGroup(db, { projectId: project.id, name: g.name, scopeDescription: g.scopeDescription, repoTags: g.repoTags });
    groupIds[g.key] = row.id;
    await setGroupMembers(db, row.id, [ids[g.key]]);
  }

  // 5) 도메인 지식: 인수인계 문서 2절 소제목 + 5절 '상태 전이'
  for (const doc of splitHandover(opts.handoverMarkdown)) {
    await upsertDomainDoc(db, { projectId: project.id, title: doc.title, body: doc.body, editorId: ids.lead });
  }

  // 6) 과거 티켓(실제 이벤트 포함)
  for (const h of HISTORY) {
    if (await seedHistoricalTicket(db, project.id, h, ids, groupIds)) created.tickets++;
  }

  log(`project ${project.id}`);
  return { projectId: project.id, created };
}

/** 티켓 하나를 처음부터 끝(또는 진행 중)까지 서비스로 진행한다. 중간에 멈췄던 티켓은 이어서 진행한다. 새로 만들었으면 true. */
async function seedHistoricalTicket(
  db: Db,
  projectId: string,
  h: HistoricalTicket,
  ids: Record<DemoAccount["key"], string>,
  groupIds: Record<DemoAccount["key"], string>,
): Promise<boolean> {
  const current = async () => {
    const [t] = await db.select().from(tickets).where(and(eq(tickets.projectId, projectId), eq(tickets.title, h.title)));
    return t;
  };
  let t = await current();
  let createdNew = false;
  if (!t) {
    t = await createDraft(db, { projectId, authorId: ids[h.author], title: h.title, body: h.body, category: h.category, urgency: h.urgency });
    createdNew = true;
  }
  const act = async (who: DemoAccount["key"], action: Parameters<typeof performAction>[1]["action"]) => {
    t = await performAction(db, { ticketId: t.id, expectedVersion: t.version, action, actor: await getActorCtx(db, projectId, ids[who]) });
  };

  if (t.status === "draft") await act(h.author, { type: "submit", target: { kind: "group", groupId: groupIds[h.group] } });
  if (t.status === "queued") await act(h.assignee, { type: "claim" });

  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(comments).where(eq(comments.ticketId, t.id));
  if (n === 0) await addComment(db, { ticketId: t.id, authorId: ids[h.assignee], body: h.comment });

  if (h.finish) {
    if (t.status === "in_progress") await act(h.assignee, { type: "resolve", linkedRefs: h.finish.linkedRefs });
    if (t.status === "resolved") await act(h.author, { type: "confirmFixed" });
  }

  const [hasSummary] = await db.select({ id: ticketSummaries.ticketId }).from(ticketSummaries).where(eq(ticketSummaries.ticketId, t.id));
  if (!hasSummary) {
    await db.insert(ticketSummaries).values({
      ticketId: t.id,
      markdown: `## 증상\n${h.body}\n\n> 인터뷰 없이 제출됨`,
      data: { fillRate: 0.4 },
      generatedFrom: "original_only",
    });
  }
  return createdNew;
}

/** 시드가 만든 행 수를 센다(멱등성 확인용: 두 번 실행해도 같아야 한다). */
export async function countSeed(db: Db, projectId: string): Promise<Record<string, number>> {
  const count = async (query: ReturnType<typeof sql>) => {
    const res = (await db.execute(query)) as unknown as { rows: { n: number | string }[] };
    return Number(res.rows[0].n);
  };
  return {
    users: await count(sql`select count(*) as n from "user"`),
    projects: await count(sql`select count(*) as n from projects`),
    members: await count(sql`select count(*) as n from member m join projects p on p.organization_id = m.organization_id where p.id = ${projectId}`),
    groups: await count(sql`select count(*) as n from groups where project_id = ${projectId}`),
    groupMembers: await count(sql`select count(*) as n from group_members gm join groups g on g.id = gm.group_id where g.project_id = ${projectId}`),
    domainDocs: await count(sql`select count(*) as n from domain_docs where project_id = ${projectId}`),
    agentProfiles: await count(sql`select count(*) as n from agent_profile_versions where project_id = ${projectId}`),
    tickets: await count(sql`select count(*) as n from tickets where project_id = ${projectId}`),
    ticketEvents: await count(sql`select count(*) as n from ticket_events e join tickets t on t.id = e.ticket_id where t.project_id = ${projectId}`),
    comments: await count(sql`select count(*) as n from comments c join tickets t on t.id = c.ticket_id where t.project_id = ${projectId}`),
    ticketSummaries: await count(sql`select count(*) as n from ticket_summaries s join tickets t on t.id = s.ticket_id where t.project_id = ${projectId}`),
    repoSnapshots: await count(sql`select count(*) as n from repo_snapshots where project_id = ${projectId}`),
    jobs: await count(sql`select count(*) as n from jobs`),
  };
}
