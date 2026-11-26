import { and, asc, desc, eq, inArray } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { groups, member, projects, ticketEvents, ticketReviewTurns, ticketSummaries, tickets, user, type AiProvider } from "@/lib/db/schema";
import type { ReviewTurnKind, SummaryOrigin } from "@/lib/db/schema/review";
import type { CloseReason } from "@/lib/db/schema/tickets";
import { isMemberRole, type MemberRole } from "@/lib/auth-roles";
import { getMembership } from "@/lib/access";
import { availableActions, applyAction, type ActionType, type ActorCtx } from "./state-machine";
import { getActorCtx, type Ticket } from "./service";
import type { Target } from "./targets";
import { getTimeline, type TimelineItem } from "./timeline";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (s: string) => UUID_RE.test(s);

export type PersonOption = { id: string; name: string; role: MemberRole };
export type GroupOption = { id: string; name: string; scope: string };
export type TargetOptions = { people: PersonOption[]; groups: GroupOption[] };

/** 프로젝트 멤버 전체(요청자 포함, 이름 표시용)와 그룹(이름순). */
async function loadDirectory(db: Db, projectId: string) {
  const [members, groupRows] = await Promise.all([
    db
      .select({ id: user.id, name: user.name, role: member.role })
      .from(projects)
      .innerJoin(member, eq(member.organizationId, projects.organizationId))
      .innerJoin(user, eq(user.id, member.userId))
      .where(eq(projects.id, projectId))
      .orderBy(asc(user.name)),
    db
      .select({ id: groups.id, name: groups.name, scope: groups.scopeDescription })
      .from(groups)
      .where(eq(groups.projectId, projectId))
      .orderBy(asc(groups.name)),
  ]);
  const people = members.flatMap((m) => (isMemberRole(m.role) ? [{ id: m.id, name: m.name, role: m.role }] : []));
  return { people, groups: groupRows };
}

/** 담당 대상 고르기 목록: 사람(요청자 역할 제외)과 그룹. 호출하는 쪽이 멤버 검사를 한다. */
export async function listTargetOptions(db: Db, projectId: string): Promise<TargetOptions> {
  const d = await loadDirectory(db, projectId);
  return { people: d.people.filter((p) => p.role !== "requester"), groups: d.groups };
}

export type NewTicketContext = {
  project: { id: string; name: string; aiAvailable: boolean; provider: AiProvider };
  targets: TargetOptions;
};

/** 작성 화면에 필요한 값. 멤버가 아니면 null(404). */
export async function getNewTicketContext(db: Db, projectId: string, userId: string): Promise<NewTicketContext | null> {
  if (!isUuid(projectId)) return null;
  const m = await getMembership(db, projectId, userId);
  if (!m) return null;
  const [[p], targets] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, projectId)),
    listTargetOptions(db, projectId),
  ]);
  if (!p) return null;
  return { project: { id: p.id, name: p.name, aiAvailable: p.isDemo, provider: p.defaultProvider }, targets };
}

export const targetOf = (t: Pick<Ticket, "targetUserId" | "targetGroupId">): Target =>
  t.targetUserId ? { kind: "user", userId: t.targetUserId } : t.targetGroupId ? { kind: "group", groupId: t.targetGroupId } : null;

export type TicketView = Pick<
  Ticket,
  | "id"
  | "projectId"
  | "number"
  | "title"
  | "body"
  | "category"
  | "urgency"
  | "status"
  | "reviewStage"
  | "interviewRound"
  | "version"
  | "aiAvailable"
  | "withdrawKind"
  | "closeReason"
  | "closeNote"
  | "authorId"
  | "assigneeId"
  | "createdAt"
  | "updatedAt"
> & { target: Target };

export type OpenTurn = {
  id: string;
  kind: ReviewTurnKind;
  round: number | null;
  payload: unknown;
  provider: string | null;
  createdAt: Date;
};

export type SummaryView = {
  markdown: string;
  generatedFrom: SummaryOrigin;
  fillRate: number | null;
  editedAt: Date | null;
};

export type TicketRefView = { id: string; number: number; title: string; status: Ticket["status"] };

export type TicketDetail = {
  project: { id: string; name: string; provider: AiProvider; repoUrl: string };
  ticket: TicketView;
  viewer: { userId: string; role: MemberRole; isAuthor: boolean };
  actions: ActionType[];
  /** 요청자 회수(requester_withdrawn)를 할 수 있는가. */
  canWithdraw: boolean;
  people: PersonOption[];
  groups: GroupOption[];
  /** 요청자 확인 대기 상태에서 지금 보여 줄 카드(가장 최근 턴). */
  openTurn: OpenTurn | null;
  summary: SummaryView | null;
  summaryEditable: boolean;
  /** 제출 직후 정리본을 기다리는 중(화면이 잠깐 새로 고친다). AI를 쓰는 티켓만, 제출 뒤 3분까지. */
  summaryPending: boolean;
  timeline: TimelineItem[];
  /** 처리 완료 때 링크한 PR/커밋(가장 최근 resolve 이벤트). */
  linkedRefs: string[];
  /** 같은 건으로 합류한 티켓(철회 · 중복 합류). */
  joined: TicketRefView | null;
  /** 이 티켓에 언급된 다른 티켓(중복 후보·근거)의 번호·제목. */
  refs: Record<string, TicketRefView>;
  /** 처리 담당(개발자·리드) 종결 다이얼로그에 보일 사유. 요청자 회수는 따로(canWithdraw). */
  closeReasons: CloseReason[];
  /** "안 하기로 함 제안"(담당자, 직접 안 하기로 함 종결을 못 하는 사람). */
  canProposeWontDo: boolean;
  /** 긴급도를 바꿀 수 있는가(R11: 작성자 또는 lead, 끝난 티켓 제외). */
  canSetUrgency: boolean;
  /** "중복으로 종결"에 미리 채울 원본 후보(AI 비고 또는 검토 때의 중복 후보). */
  duplicateCandidate: TicketRefView | null;
  /** 바로 제출 때 조용한 검토가 남긴 대상 추천(참고용). 대상이 지금도 프로젝트에 있을 때만. */
  aiRecommendation: { target: Target; reason: string; provider: string | null } | null;
};

const SUBMITTED_EDITABLE = new Set(["queued", "assigned"]);
const NOT_SUBMITTED = new Set(["draft", "ai_reviewing", "awaiting_requester", "withdrawn_ai_resolved"]);
const SUMMARY_WAIT_MS = 3 * 60_000;

/**
 * 상세 화면의 읽기 모델. 멤버가 아니거나, 티켓이 없거나 다른 프로젝트 것이면 null(404).
 * getTimeline은 접근 검사를 하지 않으므로 여기서 먼저 멤버인지 본다.
 */
export async function getTicketDetail(
  db: Db,
  input: { projectId: string; ticketId: string; userId: string },
): Promise<TicketDetail | null> {
  if (!isUuid(input.projectId) || !isUuid(input.ticketId)) return null;
  const m = await getMembership(db, input.projectId, input.userId);
  if (!m) return null;
  const [t] = await db
    .select()
    .from(tickets)
    .where(and(eq(tickets.id, input.ticketId), eq(tickets.projectId, input.projectId)));
  if (!t) return null;

  const [[p], dir, actor, timeline, [summaryRow], [lastTurn], [resolveEvent]] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, t.projectId)),
    loadDirectory(db, t.projectId),
    getActorCtx(db, t.projectId, input.userId),
    getTimeline(db, t.id),
    db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, t.id)),
    db.select().from(ticketReviewTurns).where(eq(ticketReviewTurns.ticketId, t.id)).orderBy(desc(ticketReviewTurns.createdAt)).limit(1),
    db
      .select({ to: ticketEvents.to })
      .from(ticketEvents)
      .where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "resolve")))
      .orderBy(desc(ticketEvents.createdAt))
      .limit(1),
  ]);

  const turnItem = lastTurn ? timeline.find((i) => i.kind === "review_turn" && i.data.id === lastTurn.id) : undefined;
  const openTurn: OpenTurn | null =
    t.status === "awaiting_requester" && lastTurn && !lastTurn.respondedAt
      ? {
          id: lastTurn.id,
          kind: lastTurn.kind,
          round: lastTurn.round,
          payload: lastTurn.payload,
          provider: turnItem?.actor.provider ?? null,
          createdAt: lastTurn.createdAt,
        }
      : null;

  // 화면에 번호·제목을 보여 줄 다른 티켓: 중복 후보, 근거 ticket:, 합류한 티켓, 중복 종결 원본.
  const ids = new Set<string>();
  for (const item of timeline) collectTicketIds(item.data, ids);
  if (t.duplicateOfId) ids.add(t.duplicateOfId);
  ids.delete(t.id);
  const idList = [...ids].filter(isUuid);
  const refRows = idList.length
    ? await db
        .select({ id: tickets.id, number: tickets.number, title: tickets.title, status: tickets.status })
        .from(tickets)
        .where(and(eq(tickets.projectId, t.projectId), inArray(tickets.id, idList)))
    : [];
  const refs = Object.fromEntries(refRows.map((r) => [r.id, r]));

  let joined: TicketRefView | null = null;
  if (t.status === "withdrawn_ai_resolved" && t.withdrawKind === "joined_duplicate") {
    const dupTurn = timeline.findLast((i) => i.kind === "review_turn" && i.data.kind === "duplicate_candidates" && i.data.response);
    const joinedId = (dupTurn?.data.response as { ticketId?: string } | undefined)?.ticketId;
    joined = joinedId ? (refs[joinedId] ?? null) : null;
  }

  const duplicateCandidateId = findDuplicateCandidate(timeline);
  if (duplicateCandidateId && !refs[duplicateCandidateId] && isUuid(duplicateCandidateId)) {
    const [r] = await db
      .select({ id: tickets.id, number: tickets.number, title: tickets.title, status: tickets.status })
      .from(tickets)
      .where(and(eq(tickets.projectId, t.projectId), eq(tickets.id, duplicateCandidateId)));
    if (r) refs[r.id] = r;
  }

  const summaryData = summaryRow?.data as { fillRate?: number } | undefined;
  const isAuthor = t.authorId === input.userId;
  const shape = { ...t };
  return {
    project: { id: p.id, name: p.name, provider: p.defaultProvider, repoUrl: p.repoUrl },
    ticket: {
      id: t.id,
      projectId: t.projectId,
      number: t.number,
      title: t.title,
      body: t.body,
      category: t.category,
      urgency: t.urgency,
      status: t.status,
      reviewStage: t.reviewStage,
      interviewRound: t.interviewRound,
      version: t.version,
      aiAvailable: t.aiAvailable,
      withdrawKind: t.withdrawKind,
      closeReason: t.closeReason,
      closeNote: t.closeNote,
      authorId: t.authorId,
      assigneeId: t.assigneeId,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
      target: targetOf(t),
    },
    viewer: { userId: input.userId, role: m.role, isAuthor },
    actions: availableActions(shape, actor),
    canWithdraw: canApply(shape, actor, { type: "close", reason: "requester_withdrawn" }),
    people: dir.people,
    groups: dir.groups,
    openTurn,
    summary: summaryRow
      ? {
          markdown: summaryRow.markdown,
          generatedFrom: summaryRow.generatedFrom,
          fillRate: typeof summaryData?.fillRate === "number" ? summaryData.fillRate : null,
          editedAt: summaryRow.editedAt,
        }
      : null,
    summaryEditable: isAuthor && SUBMITTED_EDITABLE.has(t.status) && !!summaryRow,
    summaryPending: !summaryRow && t.aiAvailable && !NOT_SUBMITTED.has(t.status) && Date.now() - t.updatedAt.getTime() < SUMMARY_WAIT_MS,
    timeline,
    linkedRefs: ((resolveEvent?.to as { linkedRefs?: unknown } | null)?.linkedRefs as string[] | undefined)?.filter((r) => typeof r === "string") ?? [],
    joined,
    refs,
    closeReasons: STAFF_CLOSE_REASONS.filter((reason) =>
      canApply(shape, actor, { type: "close", reason, note: "-", duplicateOfId: "00000000-0000-0000-0000-000000000000" }),
    ),
    canProposeWontDo:
      m.role !== "requester" &&
      !canApply(shape, actor, { type: "close", reason: "wont_do" }) &&
      ["assigned", "in_progress", "on_hold"].includes(t.status) &&
      (t.assigneeId === input.userId || (t.status === "assigned" && t.targetUserId === input.userId)),
    canSetUrgency: (m.role === "lead" || isAuthor) && t.status !== "closed" && t.status !== "withdrawn_ai_resolved",
    duplicateCandidate: duplicateCandidateId && duplicateCandidateId !== t.id ? (refs[duplicateCandidateId] ?? null) : null,
    aiRecommendation: findRecommendation(timeline, dir),
  };
}

const STAFF_CLOSE_REASONS: CloseReason[] = ["resolved_confirmed", "duplicate", "wont_do", "other"];

/** 가장 최근의 중복 후보: AI 비고(조용한 검토) 또는 검토 카드(요청자가 "다른 건"이라 답했어도 후보로 본다). */
function findDuplicateCandidate(timeline: TimelineItem[]): string | null {
  for (let i = timeline.length - 1; i >= 0; i--) {
    const item = timeline[i];
    if (item.kind === "event" && item.data.type === "ai_note") {
      const to = item.data.to as { note?: string; candidates?: { ticketId?: string }[] } | null;
      const id = to?.note === "duplicate_candidates" ? to.candidates?.[0]?.ticketId : undefined;
      if (id) return id;
    }
    if (item.kind === "review_turn" && item.data.kind === "duplicate_candidates") {
      const payload = item.data.payload as { candidates?: { ticketId?: string }[] } | null;
      const id = payload?.candidates?.[0]?.ticketId;
      if (id) return id;
    }
  }
  return null;
}

/** 조용한 검토의 대상 추천(ai_note). 추천 대상이 지금 프로젝트에 없으면 null. */
function findRecommendation(
  timeline: TimelineItem[],
  dir: { people: PersonOption[]; groups: { id: string }[] },
): TicketDetail["aiRecommendation"] {
  const item = timeline.findLast((i) => i.kind === "event" && i.data.type === "ai_note" && (i.data.to as { note?: string } | null)?.note === "target_recommendation");
  if (!item) return null;
  const to = item.data.to as { target?: { kind?: string; userId?: string; groupId?: string } | null; reason?: string };
  const target = to.target;
  if (!target) return null;
  if (target.kind === "group" && target.groupId && dir.groups.some((g) => g.id === target.groupId)) {
    return { target: { kind: "group", groupId: target.groupId }, reason: String(to.reason ?? ""), provider: providerFor(timeline) };
  }
  if (target.kind === "user" && target.userId && dir.people.some((p) => p.id === target.userId && p.role !== "requester")) {
    return { target: { kind: "user", userId: target.userId }, reason: String(to.reason ?? ""), provider: providerFor(timeline) };
  }
  return null;
}

const providerFor = (timeline: TimelineItem[]) =>
  timeline.findLast((i) => i.kind === "judgment" && i.data.role === "recommender")?.actor.provider ?? null;

function canApply(t: Ticket, actor: ActorCtx, action: Parameters<typeof applyAction>[1]): boolean {
  try {
    applyAction(t, action, actor);
    return true;
  } catch {
    return false;
  }
}

/** 판단·카드·이벤트 데이터에서 `ticketId` 값과 `ticket:<id>` 근거를 모은다. */
function collectTicketIds(value: unknown, out: Set<string>, depth = 0): void {
  if (depth > 6 || value == null) return;
  if (typeof value === "string") {
    if (value.startsWith("ticket:")) out.add(value.slice("ticket:".length));
    return;
  }
  if (Array.isArray(value)) {
    for (const v of value) collectTicketIds(v, out, depth + 1);
    return;
  }
  if (typeof value === "object") {
    for (const [k, v] of Object.entries(value)) {
      if ((k === "ticketId" || k === "duplicateOfId") && typeof v === "string") out.add(v);
      else collectTicketIds(v, out, depth + 1);
    }
  }
}
