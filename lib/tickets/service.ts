import { and, eq, max, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getMembership, ForbiddenError } from "@/lib/access";
import { groupMembers, groups, projects, ticketEvents, ticketSubscriptions, tickets } from "@/lib/db/schema";
import type { Category, Urgency } from "@/lib/db/schema";
import { emitNotifications } from "@/lib/notifications/emit";
import { applyAction, TransitionError, type ActorCtx, type TicketAction } from "./state-machine";
import { validateTarget, type Target } from "./targets";

export type Ticket = typeof tickets.$inferSelect;

export class ConflictError extends Error {
  constructor(message = "이미 다른 사람이 처리했어요. 새로고침해 주세요.") {
    super(message);
    this.name = "ConflictError";
  }
}

export class TicketNotFoundError extends Error {
  constructor(message = "티켓을 찾을 수 없어요.") {
    super(message);
    this.name = "TicketNotFoundError";
  }
}

export class InvalidDuplicateError extends Error {
  constructor(message = "중복 대상은 같은 프로젝트의 다른 티켓이어야 해요.") {
    super(message);
    this.name = "InvalidDuplicateError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** 역할 + 이 프로젝트에서 속한 그룹 id들. 멤버가 아니면 ForbiddenError. */
export async function getActorCtx(db: Db, projectId: string, userId: string): Promise<ActorCtx> {
  const m = await getMembership(db, projectId, userId);
  if (!m) throw new ForbiddenError("이 프로젝트의 멤버가 아니에요.");
  const rows = await db
    .select({ id: groupMembers.groupId })
    .from(groupMembers)
    .innerJoin(groups, eq(groups.id, groupMembers.groupId))
    .where(and(eq(groupMembers.userId, userId), eq(groups.projectId, projectId)));
  return { userId, role: m.role, groupIds: rows.map((r) => r.id) };
}

/** 대상 칸에 쓸 값(사람/그룹/없음). */
const targetColumns = (target: Target) => ({
  targetUserId: target?.kind === "user" ? target.userId : null,
  targetGroupId: target?.kind === "group" ? target.groupId : null,
});

/** 구독 추가(멱등). */
export async function subscribe(db: Db, ticketId: string, userId: string): Promise<void> {
  await db.insert(ticketSubscriptions).values({ ticketId, userId }).onConflictDoNothing();
}

export async function createDraft(
  db: Db,
  input: {
    projectId: string;
    authorId: string;
    title: string;
    body: string;
    category: Category;
    urgency: Urgency;
    target?: Target;
  },
): Promise<Ticket> {
  const m = await getMembership(db, input.projectId, input.authorId);
  if (!m) throw new ForbiddenError("이 프로젝트의 멤버가 아니에요.");
  const target = input.target === undefined ? null : await validateTarget(db, input.projectId, input.target);
  return db.transaction(async (tx) => {
    // 같은 프로젝트의 동시 생성이 같은 번호를 잡지 않도록 프로젝트 단위로 직렬화한다.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${input.projectId}))`);
    const [project] = await tx.select({ isDemo: projects.isDemo }).from(projects).where(eq(projects.id, input.projectId));
    const [{ n }] = await tx.select({ n: max(tickets.number) }).from(tickets).where(eq(tickets.projectId, input.projectId));
    const [t] = await tx
      .insert(tickets)
      .values({
        projectId: input.projectId,
        number: (n ?? 0) + 1,
        authorId: input.authorId,
        title: input.title,
        body: input.body,
        category: input.category,
        urgency: input.urgency,
        aiAvailable: project.isDemo,
        ...targetColumns(target),
      })
      .returning();
    await tx.insert(ticketEvents).values({
      ticketId: t.id,
      actorId: input.authorId,
      actorKind: "user",
      type: "created",
      to: { status: t.status, urgency: t.urgency, ...targetColumns(target) },
    });
    await subscribe(tx, t.id, input.authorId);
    return t;
  });
}

/** 패치에 실제로 들어 있는 키만 {키: 값}으로 모은다(이벤트 from/to 기록용). */
function pick(source: Record<string, unknown>, keys: string[]) {
  return Object.fromEntries(keys.map((k) => [k, source[k] ?? null]));
}

/**
 * 티켓에 동작을 적용한다. 하나의 트랜잭션에서 로드 → 상태 기계 → 대상/중복 검증 →
 * `UPDATE … WHERE id=? AND version=?` → 이벤트 → 알림.
 *
 * lastAssigneeId: ticket_events에서 따로 구하지 않는다. `close`는 assigneeId를 비우지 않으므로
 * `reopenClosed`는 상태 기계의 assigneeId 폴백만으로 이전 담당자를 찾는다(이관 후 종결이면 null → 리드 큐).
 */
export async function performAction(
  db: Db,
  input: { ticketId: string; expectedVersion: number; action: TicketAction; actor: ActorCtx },
): Promise<Ticket> {
  const { ticketId, expectedVersion, action, actor } = input;
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tickets).where(eq(tickets.id, ticketId));
    if (!cur) throw new TicketNotFoundError();
    // 이미 다른 요청이 커밋한 뒤라면, 상태가 달라져 보이는 거부(TransitionError) 대신 충돌로 알린다.
    if (cur.version !== expectedVersion) throw new ConflictError();

    const patch = applyAction(cur, action, actor);

    if (action.type === "submit" || action.type === "assignTarget" || action.type === "transfer") {
      await validateTarget(tx, cur.projectId, action.target);
    }
    if (action.type === "close" && action.reason === "duplicate") {
      await assertDuplicateOrigin(tx, cur, patch.duplicateOfId);
    }

    // 동시에 같은 version을 읽은 다른 트랜잭션이 먼저 커밋했다면 0행이 갱신된다.
    const [updated] = await tx
      .update(tickets)
      .set({ ...patch, version: sql`${tickets.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tickets.id, ticketId), eq(tickets.version, expectedVersion)))
      .returning();
    if (!updated) throw new ConflictError();

    const keys = Object.keys(patch);
    const [event] = await tx
      .insert(ticketEvents)
      .values({
        ticketId,
        actorId: actor.userId,
        actorKind: actor.role === "system" ? "system" : "user",
        type: action.type,
        from: pick(cur, keys),
        to: pick(updated, keys),
        reason: reasonOf(action),
      })
      .returning();

    if (action.type === "close" && action.reason === "duplicate" && updated.duplicateOfId) {
      await carrySubscribersToOrigin(tx, cur.id, updated.duplicateOfId);
    }
    await emitNotifications(tx, event, updated);
    return updated;
  });
}

function reasonOf(action: TicketAction): string | null {
  switch (action.type) {
    case "transfer":
    case "hold":
    case "reopen":
      return action.reason.trim();
    case "close":
      return action.note?.trim() || action.reason;
    default:
      return null;
  }
}

async function assertDuplicateOrigin(tx: Db, t: Ticket, duplicateOfId: string | null | undefined) {
  if (!duplicateOfId || !UUID_RE.test(duplicateOfId)) throw new InvalidDuplicateError();
  if (duplicateOfId === t.id) throw new InvalidDuplicateError("자기 자신은 중복 대상이 될 수 없어요.");
  const [origin] = await tx
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.id, duplicateOfId), eq(tickets.projectId, t.projectId)));
  if (!origin) throw new InvalidDuplicateError();
}

/** 중복 종결: 이 티켓의 작성자와 구독자를 원본 티켓의 구독자로 옮긴다(메인 6.7). */
async function carrySubscribersToOrigin(tx: Db, ticketId: string, originId: string) {
  const [t] = await tx.select({ authorId: tickets.authorId }).from(tickets).where(eq(tickets.id, ticketId));
  const subs = await tx.select({ id: ticketSubscriptions.userId }).from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, ticketId));
  const ids = [...new Set([t.authorId, ...subs.map((s) => s.id)])];
  await tx.insert(ticketSubscriptions).values(ids.map((userId) => ({ ticketId: originId, userId }))).onConflictDoNothing();
}

/**
 * 긴급도 변경. 사람만 호출한다(AI 경로 없음). 허용(R11): 티켓 작성자(종결·철회 전 어느 상태든)와 프로젝트 lead.
 * 종결·철회된 티켓은 바꿀 수 없다. 값이 같으면 아무것도 쓰지 않는다. 바뀌면 version이 올라 다른 동작과 충돌 처리된다.
 */
export async function setUrgency(db: Db, input: { ticketId: string; to: Urgency; actorId: string }): Promise<Ticket> {
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
    if (!cur) throw new TicketNotFoundError();
    const m = await getMembership(tx, cur.projectId, input.actorId);
    if (!m) throw new ForbiddenError("이 프로젝트의 멤버가 아니에요.");
    // R11: 티켓 작성자(종결 전이면 언제든)와 프로젝트 lead만. 담당 개발자도 작성자가 아니면 바꿀 수 없다.
    if (!(m.role === "lead" || cur.authorId === input.actorId)) throw new ForbiddenError();
    if (cur.status === "closed" || cur.status === "withdrawn_ai_resolved") {
      throw new ForbiddenError("끝난 티켓의 긴급도는 바꿀 수 없어요.");
    }
    if (cur.urgency === input.to) return cur;
    const [updated] = await tx
      .update(tickets)
      .set({ urgency: input.to, version: sql`${tickets.version} + 1`, updatedAt: new Date() })
      .where(and(eq(tickets.id, cur.id), eq(tickets.version, cur.version)))
      .returning();
    if (!updated) throw new ConflictError();
    const [event] = await tx
      .insert(ticketEvents)
      .values({
        ticketId: cur.id,
        actorId: input.actorId,
        actorKind: "user",
        type: "urgency_changed",
        from: { urgency: cur.urgency },
        to: { urgency: input.to },
      })
      .returning();
    await emitNotifications(tx, event, updated);
    return updated;
  });
}

/** "안 하기로 함" 제안. 담당자(R1)만. 티켓은 바뀌지 않고 이벤트와 lead 알림만 남는다. */
export async function proposeWontDo(
  db: Db,
  input: { ticketId: string; actorId: string; reason: string },
): Promise<Ticket> {
  const reason = input.reason.trim();
  if (!reason) throw new TransitionError("reason_required", "제안 사유를 적어 주세요.");
  return db.transaction(async (tx) => {
    const [cur] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
    if (!cur) throw new TicketNotFoundError();
    const m = await getMembership(tx, cur.projectId, input.actorId);
    const isAssignee =
      cur.assigneeId === input.actorId || (cur.status === "assigned" && cur.targetUserId === input.actorId);
    if (!m || m.role === "requester" || !isAssignee) throw new ForbiddenError("담당자만 제안할 수 있어요.");
    if (!["assigned", "in_progress", "on_hold"].includes(cur.status)) {
      throw new ForbiddenError("지금 상태에서는 제안할 수 없어요.");
    }
    const [event] = await tx
      .insert(ticketEvents)
      .values({
        ticketId: cur.id,
        actorId: input.actorId,
        actorKind: "user",
        type: "wont_do_proposed",
        reason,
      })
      .returning();
    await emitNotifications(tx, event, cur);
    return cur;
  });
}
