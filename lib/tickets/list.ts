import { and, desc, eq, ilike, inArray, isNull, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import type { Db } from "@/lib/db";
import { groups, member, projects, ticketEvents, tickets, user, type AiProvider } from "@/lib/db/schema";
import type { Category, TicketStatus, Urgency } from "@/lib/db/schema/tickets";
import type { MemberRole } from "@/lib/auth-roles";
import { ForbiddenError } from "@/lib/access";
import { getActorCtx } from "./service";
import type { ActorCtx } from "./state-machine";
import { defaultView, LIST_CAP, viewsFor, type TicketView } from "./views";
import { submittedOnly, visibleTo } from "./visibility";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const DONE: TicketStatus[] = ["closed"];

export type AiNoteView =
  | { kind: "recommendation"; targetLabel: string; reason: string }
  | { kind: "duplicate"; count: number }
  | { kind: "resolution" };

export type TicketRow = {
  id: string;
  number: number;
  title: string;
  category: Category;
  urgency: Urgency;
  status: TicketStatus;
  target: { kind: "user" | "group" | "lead"; label: string };
  assigneeName: string | null;
  authorName: string;
  updatedAt: Date;
  /** 바로 제출 때 남은 조용한 검토 비고(가장 중요한 것 하나). 리드 큐에서는 추천 대상을 참고로 보인다. */
  aiNote: AiNoteView | null;
};

export type TicketList = {
  role: MemberRole;
  provider: AiProvider;
  view: TicketView;
  views: TicketView[];
  /** 뷰별 전체 개수(긴급도·상태 필터와 무관). */
  counts: Partial<Record<TicketView, number>>;
  rows: TicketRow[];
  /** 필터를 건 전체 개수(rows는 LIST_CAP까지). */
  total: number;
};

export type ListInput = {
  projectId: string;
  userId: string;
  view?: TicketView | null;
  urgency?: readonly Urgency[];
  status?: readonly TicketStatus[];
};

/**
 * 뷰 조건(결정 사항). R24: "내 요청" 말고는 모두 제출된 티켓만 보고(submittedOnly),
 * listTickets가 모든 뷰·개수에 visibleTo(나)를 한 번 더 건다(다른 사람의 제출 안 된 티켓은 어디에도 없다).
 */
function viewWhere(view: TicketView, a: ActorCtx, hasStatusFilter: boolean): SQL | undefined {
  const me = a.userId!;
  switch (view) {
    case "mine":
      // R1: 대상 사람이 나 또는 담당자가 나. 상태 필터가 없으면 끝난 티켓은 뺀다.
      return and(
        or(eq(tickets.targetUserId, me), eq(tickets.assigneeId, me)),
        submittedOnly(),
        hasStatusFilter ? undefined : notInArray(tickets.status, DONE),
      );
    case "group":
      if (a.groupIds.length === 0) return sql`false`;
      return and(eq(tickets.status, "queued"), inArray(tickets.targetGroupId, a.groupIds));
    case "lead":
      if (a.role !== "lead") return sql`false`;
      return and(eq(tickets.status, "queued"), isNull(tickets.targetGroupId), isNull(tickets.targetUserId));
    case "confirm":
      return and(eq(tickets.status, "resolved"), a.role === "lead" ? undefined : eq(tickets.authorId, me));
    case "all":
      return submittedOnly();
    case "requested":
      return eq(tickets.authorId, me);
  }
}

const urgencyRank = sql<number>`case ${tickets.urgency} when 'urgent' then 4 when 'high' then 3 when 'normal' then 2 else 1 end`;

/**
 * 티켓 목록(서버 필터). 멤버가 아니면 ForbiddenError. 리드가 아닌 사람이 리드 큐를 고르면 기본 뷰로 바꾼다.
 * 정렬: 긴급도 높은 순 → 최근 바뀐 순. 최대 LIST_CAP(100)건, total로 전체 개수를 알린다.
 */
export async function listTickets(db: Db, input: ListInput): Promise<TicketList> {
  if (!UUID_RE.test(input.projectId)) throw new ForbiddenError("이 프로젝트의 멤버가 아니에요.");
  const actor = await getActorCtx(db, input.projectId, input.userId);
  const role = actor.role as MemberRole;
  const views = viewsFor(role);
  const view = input.view && views.includes(input.view) ? input.view : defaultView(role);
  const urgency = [...(input.urgency ?? [])];
  const status = [...(input.status ?? [])];

  const filters = (v: TicketView) =>
    and(
      eq(tickets.projectId, input.projectId),
      visibleTo(actor.userId!),
      viewWhere(v, actor, status.length > 0),
      urgency.length ? inArray(tickets.urgency, urgency) : undefined,
      status.length ? inArray(tickets.status, status) : undefined,
    );
  // 탭 뱃지 개수는 필터와 상관없는 뷰 전체 개수다(제품 결정 5-8). 필터를 걸면 화면이 "N건 중 M건"으로 보여 준다.
  const unfiltered = (v: TicketView) => and(eq(tickets.projectId, input.projectId), visibleTo(actor.userId!), viewWhere(v, actor, false));

  const targetUser = alias(user, "target_user");
  const assignee = alias(user, "assignee");
  const author = alias(user, "author");

  const [rows, countRows, [project]] = await Promise.all([
    db
      .select({
        id: tickets.id,
        number: tickets.number,
        title: tickets.title,
        category: tickets.category,
        urgency: tickets.urgency,
        status: tickets.status,
        targetUserId: tickets.targetUserId,
        targetGroupId: tickets.targetGroupId,
        targetUserName: targetUser.name,
        targetGroupName: groups.name,
        assigneeName: assignee.name,
        authorName: author.name,
        updatedAt: tickets.updatedAt,
        total: sql<number>`count(*) over()`,
      })
      .from(tickets)
      .leftJoin(targetUser, eq(targetUser.id, tickets.targetUserId))
      .leftJoin(groups, eq(groups.id, tickets.targetGroupId))
      .leftJoin(assignee, eq(assignee.id, tickets.assigneeId))
      .innerJoin(author, eq(author.id, tickets.authorId))
      .where(filters(view))
      .orderBy(desc(urgencyRank), desc(tickets.updatedAt), desc(tickets.number))
      .limit(LIST_CAP),
    Promise.all(
      views.map(async (v) => {
        const [r] = await db.select({ n: sql<number>`count(*)::int` }).from(tickets).where(unfiltered(v));
        return [v, Number(r?.n ?? 0)] as const;
      }),
    ),
    db.select({ provider: projects.defaultProvider }).from(projects).where(eq(projects.id, input.projectId)),
  ]);

  const notes = await loadAiNotes(db, input.projectId, rows.map((r) => r.id));
  return {
    role,
    provider: project.provider,
    view,
    views,
    counts: Object.fromEntries(countRows),
    total: rows.length ? Number(rows[0].total) : 0,
    rows: rows.map((r) => ({
      id: r.id,
      number: r.number,
      title: r.title,
      category: r.category,
      urgency: r.urgency,
      status: r.status,
      target: r.targetUserId
        ? { kind: "user", label: r.targetUserName ?? "프로젝트에 없는 사람" }
        : r.targetGroupId
          ? { kind: "group", label: r.targetGroupName ?? "삭제된 그룹" }
          : { kind: "lead", label: "리드 큐" },
      assigneeName: r.assigneeName,
      authorName: r.authorName,
      updatedAt: r.updatedAt,
      aiNote: notes.get(r.id) ?? null,
    })),
  };
}

type NoteTo = { note?: string; target?: { kind?: string; userId?: string; groupId?: string } | null; reason?: string; candidates?: unknown[] };

/**
 * 티켓별 AI 비고(ai_note 이벤트) 하나: 추천 대상 > 중복 후보 > 해소 가능 순으로 고른다.
 * 추천 대상의 이름은 지금 프로젝트에 있는 사람·그룹으로 풀고, 없어졌으면 비고를 보이지 않는다.
 */
export async function loadAiNotes(db: Db, projectId: string, ticketIds: string[]): Promise<Map<string, AiNoteView>> {
  const out = new Map<string, AiNoteView>();
  if (ticketIds.length === 0) return out;
  const events = await db
    .select({ ticketId: ticketEvents.ticketId, to: ticketEvents.to })
    .from(ticketEvents)
    .where(and(inArray(ticketEvents.ticketId, ticketIds), eq(ticketEvents.type, "ai_note")))
    .orderBy(desc(ticketEvents.createdAt));
  if (events.length === 0) return out;

  const names = await targetNames(db, projectId);
  const rank = { recommendation: 3, duplicate: 2, resolution: 1 } as const;
  for (const e of events) {
    const to = (e.to ?? {}) as NoteTo;
    let note: AiNoteView | null = null;
    if (to.note === "target_recommendation" && to.target) {
      const key = to.target.kind === "user" ? `user:${to.target.userId}` : `group:${to.target.groupId}`;
      const label = names.get(key);
      if (label) note = { kind: "recommendation", targetLabel: label, reason: String(to.reason ?? "") };
    } else if (to.note === "duplicate_candidates" && Array.isArray(to.candidates) && to.candidates.length) {
      note = { kind: "duplicate", count: to.candidates.length };
    } else if (to.note === "resolution") {
      note = { kind: "resolution" };
    }
    if (!note) continue;
    const cur = out.get(e.ticketId);
    if (!cur || rank[note.kind] > rank[cur.kind]) out.set(e.ticketId, note);
  }
  return out;
}

async function targetNames(db: Db, projectId: string): Promise<Map<string, string>> {
  const [people, gs] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, role: member.role })
      .from(projects)
      .innerJoin(member, eq(member.organizationId, projects.organizationId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(and(eq(projects.id, projectId), ne(member.role, "requester"))),
    db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.projectId, projectId)),
  ]);
  return new Map([...people.map((p) => [`user:${p.id}`, p.name] as const), ...gs.map((g) => [`group:${g.id}`, g.name] as const)]);
}

export type TicketHit = { id: string; number: number; title: string; status: TicketStatus };

/**
 * 명령 팔레트 검색. 멤버만(아니면 ForbiddenError). `#12`나 `12`는 번호로, 그 밖은 제목·본문 전문 검색 + 제목 부분 일치.
 * 다른 사람의 제출 전 티켓은 나오지 않는다.
 */
export async function searchTickets(db: Db, input: { projectId: string; userId: string; query: string; limit?: number }): Promise<TicketHit[]> {
  if (!UUID_RE.test(input.projectId)) throw new ForbiddenError("이 프로젝트의 멤버가 아니에요.");
  await getActorCtx(db, input.projectId, input.userId);
  const q = input.query.trim().slice(0, 200);
  if (!q) return [];
  const visible = visibleTo(input.userId);
  const cols = { id: tickets.id, number: tickets.number, title: tickets.title, status: tickets.status };

  const num = q.match(/^#?(\d{1,9})$/);
  if (num) {
    return db
      .select(cols)
      .from(tickets)
      .where(and(eq(tickets.projectId, input.projectId), eq(tickets.number, Number(num[1])), visible))
      .limit(1);
  }
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const tsq = sql`plainto_tsquery('simple', ${q})`;
  return db
    .select(cols)
    .from(tickets)
    .where(and(eq(tickets.projectId, input.projectId), visible, or(ilike(tickets.title, like), sql`${tickets.searchVector} @@ ${tsq}`)))
    .orderBy(sql`(${tickets.title} ilike ${like}) desc`, desc(tickets.updatedAt))
    .limit(input.limit ?? 8);
}
