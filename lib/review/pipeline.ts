import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { aiJudgments, ticketEvents, ticketReviewTurns, tickets } from "@/lib/db/schema";
import type { JudgmentStatus } from "@/lib/db/schema/ai";
import type { ReviewTurnKind } from "@/lib/db/schema/review";
import type { ReviewStage, WithdrawKind } from "@/lib/db/schema/tickets";
import { getActiveProfile, type AgentProfile } from "@/lib/agents/profiles";
import { buildTools } from "@/lib/agents/tools";
import { dedupSchema, dedupSystem } from "@/lib/agents/dedup";
import { resolveSchema, resolveSystem } from "@/lib/agents/resolve";
import { runRoleAgent as defaultRunRoleAgent, type RunRoleAgentResult } from "@/lib/ai/run-agent";
import { addComment } from "@/lib/comments/service";
import { enqueue, kickJobs } from "@/lib/jobs/queue";
import { loadEvidenceCtx, normalizeDedup, normalizeResolve } from "@/lib/review/normalize";
import { ConflictError, performAction, subscribe, TicketNotFoundError, type Ticket } from "@/lib/tickets/service";
import { TransitionError, type ActorCtx } from "@/lib/tickets/state-machine";
import type { Target } from "@/lib/tickets/targets";

export const FAILED_MESSAGE = "AI 검토에 실패했어요. 그대로 제출할 수 있어요.";
const SYSTEM: ActorCtx = { userId: null, role: "system", groupIds: [] };

export class AiUnavailableError extends Error {
  constructor(message = "이 프로젝트는 AI 검토를 쓸 수 없어요. 바로 제출돼요.") {
    super(message);
    this.name = "AiUnavailableError";
  }
}

export class NoOpenCardError extends Error {
  constructor(message = "응답할 카드가 없어요. 새로고침해 주세요.") {
    super(message);
    this.name = "NoOpenCardError";
  }
}

export type ReviewDeps = {
  runRoleAgent?: typeof defaultRunRoleAgent;
  timeoutMs?: number;
};

/** 늦게 끝난 작업: 그 사이 티켓이 바뀌었다. */
class StaleError extends Error {}
const isStale = (e: unknown) => e instanceof StaleError || e instanceof ConflictError || e instanceof TransitionError;

type Tx = Db;
const stageEvent = (tx: Tx, ticketId: string, from: ReviewStage | null, to: ReviewStage) =>
  tx.insert(ticketEvents).values({
    ticketId,
    actorId: null,
    actorKind: "system",
    type: "review_stage_changed",
    from: { reviewStage: from },
    to: { reviewStage: to },
  });

/** 버전을 올리지 않고 검토 단계만 옮긴다. version이 달라졌으면 StaleError. */
async function moveStage(tx: Tx, t: { id: string; reviewStage: ReviewStage | null }, version: number, to: ReviewStage) {
  const rows = await tx
    .update(tickets)
    .set({ reviewStage: to, updatedAt: new Date() })
    .where(and(eq(tickets.id, t.id), eq(tickets.version, version), eq(tickets.status, "ai_reviewing")))
    .returning({ id: tickets.id });
  if (rows.length === 0) throw new StaleError();
  await stageEvent(tx, t.id, t.reviewStage, to);
}

// ---------- 요청 ----------

export async function requestReview(
  db: Db,
  input: { ticketId: string; expectedVersion: number; actor: ActorCtx },
): Promise<Ticket> {
  const [cur] = await db.select().from(tickets).where(eq(tickets.id, input.ticketId));
  if (!cur) throw new TicketNotFoundError();
  if (!cur.aiAvailable) throw new AiUnavailableError();
  const updated = await db.transaction(async (tx) => {
    const t = await performAction(tx, {
      ticketId: input.ticketId,
      expectedVersion: input.expectedVersion,
      action: { type: "requestReview" },
      actor: input.actor,
    });
    // 같은 version에서 단계만 정한다(performAction이 이미 version을 올렸다).
    await tx.update(tickets).set({ reviewStage: "dedup" }).where(eq(tickets.id, t.id));
    await stageEvent(tx, t.id, null, "dedup");
    await enqueue(tx, "ticket.reviewStage", { ticketId: t.id, stage: "dedup", version: t.version });
    return { ...t, reviewStage: "dedup" as const };
  });
  kickJobs();
  return updated;
}

// ---------- 단계 실행 ----------

const ticketPrompt = (t: Ticket) =>
  [`검토 중인 티켓 id: ${t.id}`, `제목: ${t.title}`, `분류: ${t.category}`, `긴급도: ${t.urgency}`, "", "본문:", t.body].join("\n");

type JudgmentBase = {
  projectId: string;
  ticketId: string;
  stage: ReviewStage;
  profile: AgentProfile;
  input: unknown;
};

async function insertJudgment(
  tx: Tx,
  base: JudgmentBase,
  extra: {
    status: JudgmentStatus;
    output?: unknown;
    normalized?: unknown;
    evidence?: unknown;
    run?: Pick<RunRoleAgentResult<unknown>, "steps" | "usage" | "traceId">;
    error?: string;
  },
) {
  const [j] = await tx
    .insert(aiJudgments)
    .values({
      ticketId: base.ticketId,
      projectId: base.projectId,
      role: "resolver",
      stage: base.stage,
      round: null,
      profileVersionId: base.profile.versionId,
      input: base.input,
      output: extra.output ?? {},
      normalized: extra.normalized ?? null,
      evidence: extra.evidence ?? [],
      steps: extra.run?.steps ?? [],
      status: extra.status,
      error: extra.error ?? null,
      inputTokens: extra.run?.usage.inputTokens ?? null,
      outputTokens: extra.run?.usage.outputTokens ?? null,
      traceId: extra.run?.traceId ?? null,
    })
    .returning();
  return j;
}

const insertTurn = (tx: Tx, ticketId: string, stage: ReviewStage, kind: ReviewTurnKind, payload: unknown, judgmentId: string) =>
  tx.insert(ticketReviewTurns).values({ ticketId, stage, round: null, kind, payload, judgmentId });

type StageOutcome = "proceed" | "stop";

/**
 * 한 단계를 실행한다. 중복 확인과 해소 확인은 둘 다 resolver 프로필을 쓴다(defaults.ts에 dedup 전용 역할이 없다).
 * 결과는 같은 트랜잭션 안에서 티켓 version을 다시 확인한 뒤에만 반영한다. 그 사이 티켓이 바뀌었으면 판단만 `discarded`로 남긴다.
 */
export async function runReviewStage(
  db: Db,
  job: { ticketId: string; stage: ReviewStage; version: number },
  deps: ReviewDeps = {},
): Promise<void> {
  const [t0] = await db.select().from(tickets).where(eq(tickets.id, job.ticketId));
  if (!t0) return;
  if (job.stage !== "dedup" && job.stage !== "resolve") {
    // interview 이후 단계는 Task 10이 채운다.
    throw new Error(`no runner for review stage: ${job.stage}`);
  }
  const profile = await getActiveProfile(db, t0.projectId, "resolver");
  const base = (stage: ReviewStage): JudgmentBase => ({
    projectId: t0.projectId,
    ticketId: t0.id,
    stage,
    profile,
    input: { title: t0.title, body: t0.body, category: t0.category, urgency: t0.urgency },
  });

  if (t0.status !== "ai_reviewing" || t0.version !== job.version) {
    await insertJudgment(db, base(job.stage), { status: "discarded", error: "검토 시작 전에 티켓이 바뀌었어요." });
    return;
  }

  if (job.stage === "dedup") {
    const outcome = await runDedupStage(db, t0, job.version, profile, base("dedup"), deps);
    if (outcome === "stop") return;
  }
  await runResolveStage(db, t0, job.version, profile, base("resolve"), deps);
}

type Run = Awaited<ReturnType<typeof defaultRunRoleAgent>>;

async function invoke<T>(
  db: Db,
  t: Ticket,
  profile: AgentProfile,
  system: string,
  schema: z.ZodType<T>,
  deps: ReviewDeps,
): Promise<Run & { parsed: T }> {
  const run = deps.runRoleAgent ?? defaultRunRoleAgent;
  const res = await run({
    profile,
    system,
    prompt: ticketPrompt(t),
    tools: buildTools({ db, projectId: t.projectId, ticketId: t.id }),
    schema: schema as z.ZodType<unknown>,
    telemetry: { projectId: t.projectId, ticketId: t.id },
    timeoutMs: deps.timeoutMs,
  });
  // 주입된 실행기나 모델이 스키마를 어겨도 여기서 막는다.
  return { ...res, parsed: schema.parse(res.output) };
}

/** 실패 카드 + stageFailed. 그 사이 티켓이 바뀌었으면 실패 카드 대신 discarded만 남긴다. */
async function recordFailure(db: Db, job: { ticketId: string; version: number }, b: JudgmentBase, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "failed", error: message });
      await insertTurn(tx, job.ticketId, b.stage, "failed", { message: FAILED_MESSAGE }, j.id);
      await performAction(tx, { ticketId: job.ticketId, expectedVersion: job.version, action: { type: "stageFailed" }, actor: SYSTEM });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", error: message });
  }
}

async function runDedupStage(db: Db, t: Ticket, version: number, profile: AgentProfile, b: JudgmentBase, deps: ReviewDeps): Promise<StageOutcome> {
  let res: Awaited<ReturnType<typeof invoke<z.infer<typeof dedupSchema>>>>;
  try {
    res = await invoke(db, t, profile, dedupSystem(profile.instructions), dedupSchema, deps);
  } catch (err) {
    await recordFailure(db, { ticketId: t.id, version }, b, err);
    return "stop";
  }
  const ctx = await loadEvidenceCtx(db, t.projectId);
  const normalized = normalizeDedup(res.parsed, ctx, t.id);
  const differences = new Map(res.parsed.candidates.map((c) => [c.ticketId, c.differences]));
  const ids = normalized.candidates.map((c) => c.ticketId);
  const rows = ids.length
    ? await db.select({ id: tickets.id, number: tickets.number, title: tickets.title }).from(tickets).where(and(eq(tickets.projectId, t.projectId), inArray(tickets.id, ids)))
    : [];
  const info = new Map(rows.map((r) => [r.id, r]));
  const payload = {
    candidates: normalized.candidates.map((c) => ({
      ticketId: c.ticketId,
      number: info.get(c.ticketId)?.number ?? null,
      title: info.get(c.ticketId)?.title ?? "",
      reason: c.reason,
      differences: differences.get(c.ticketId) ?? "",
    })),
  };
  const done = { output: res.output, normalized: payload, evidence: ids.map((id) => ({ ref: `ticket:${id}` })), run: res };

  try {
    return await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      if (payload.candidates.length > 0) {
        await insertTurn(tx, t.id, "dedup", "duplicate_candidates", payload, j.id);
        await performAction(tx, { ticketId: t.id, expectedVersion: version, action: { type: "stageReady" }, actor: SYSTEM });
        return "stop" as const;
      }
      await moveStage(tx, t, version, "resolve");
      return "proceed" as const;
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", ...done });
    return "stop";
  }
}

async function runResolveStage(db: Db, t: Ticket, version: number, profile: AgentProfile, b: JudgmentBase, deps: ReviewDeps): Promise<StageOutcome> {
  let res: Awaited<ReturnType<typeof invoke<z.infer<typeof resolveSchema>>>>;
  try {
    res = await invoke(db, t, profile, resolveSystem(profile.instructions), resolveSchema, deps);
  } catch (err) {
    await recordFailure(db, { ticketId: t.id, version }, b, err);
    return "stop";
  }
  const ctx = await loadEvidenceCtx(db, t.projectId);
  const normalized = normalizeResolve(res.parsed, ctx, t.id);
  const done = { output: res.output, normalized, evidence: normalized?.evidence ?? [], run: res };

  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      if (normalized) {
        await insertTurn(tx, t.id, "resolve", "resolution", normalized, j.id);
        await performAction(tx, { ticketId: t.id, expectedVersion: version, action: { type: "stageReady" }, actor: SYSTEM });
        return;
      }
      await moveStage(tx, { id: t.id, reviewStage: "resolve" }, version, "interview");
      await enqueue(tx, "ticket.reviewStage", { ticketId: t.id, stage: "interview", version });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", ...done });
    return "stop";
  }
  if (!normalized) kickJobs();
  return "stop";
}

// ---------- 요청자 응답 ----------

type AnswerBase = { ticketId: string; expectedVersion: number; actor: ActorCtx };

async function openTurn(tx: Tx, ticketId: string, kind: ReviewTurnKind) {
  const [turn] = await tx
    .select()
    .from(ticketReviewTurns)
    .where(and(eq(ticketReviewTurns.ticketId, ticketId), eq(ticketReviewTurns.kind, kind), isNull(ticketReviewTurns.respondedAt)))
    .orderBy(desc(ticketReviewTurns.createdAt))
    .limit(1);
  if (!turn) throw new NoOpenCardError();
  return turn;
}

const respond = (tx: Tx, turnId: string, response: unknown) =>
  tx.update(ticketReviewTurns).set({ response, respondedAt: new Date() }).where(eq(ticketReviewTurns.id, turnId));

/** 같은 version에서 계속(재개)하는 응답: continueReview + 단계 이동 + 작업. */
async function resume(tx: Tx, input: AnswerBase, to: ReviewStage) {
  const t = await performAction(tx, { ticketId: input.ticketId, expectedVersion: input.expectedVersion, action: { type: "continueReview" }, actor: input.actor });
  const [before] = await tx.select({ s: tickets.reviewStage }).from(tickets).where(eq(tickets.id, t.id));
  await tx.update(tickets).set({ reviewStage: to }).where(eq(tickets.id, t.id));
  await stageEvent(tx, t.id, before?.s ?? null, to);
  await enqueue(tx, "ticket.reviewStage", { ticketId: t.id, stage: to, version: t.version });
}

export async function answerDuplicate(
  db: Db,
  input: AnswerBase & ({ choice: "same"; ticketIdToJoin: string } | { choice: "different" }),
): Promise<void> {
  await db.transaction(async (tx) => {
    const turn = await openTurn(tx, input.ticketId, "duplicate_candidates");
    if (input.choice === "same") {
      const cards = (turn.payload as { candidates: { ticketId: string }[] }).candidates;
      if (!cards.some((c) => c.ticketId === input.ticketIdToJoin)) throw new NoOpenCardError("카드에 없는 티켓이에요.");
      const [mine] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
      await performAction(tx, {
        ticketId: input.ticketId,
        expectedVersion: input.expectedVersion,
        action: { type: "withdraw", kind: "joined_duplicate" },
        actor: input.actor,
      });
      await addComment(tx, {
        ticketId: input.ticketIdToJoin,
        authorId: mine.authorId,
        body: `[같은 건으로 합류] ${mine.title}\n\n${mine.body}`,
      });
      await subscribe(tx, input.ticketIdToJoin, mine.authorId);
      await respond(tx, turn.id, { choice: "same", ticketId: input.ticketIdToJoin });
      return;
    }
    await resume(tx, input, "resolve");
    await respond(tx, turn.id, { choice: "different" });
  });
  if (input.choice === "different") kickJobs();
}

export async function answerResolution(
  db: Db,
  input: AnswerBase & { choice: "resolved" | "continue" | "submit" },
): Promise<void> {
  await db.transaction(async (tx) => {
    const turn = await openTurn(tx, input.ticketId, "resolution");
    if (input.choice === "resolved") {
      const kind = (turn.payload as { kind: WithdrawKind }).kind;
      await performAction(tx, { ticketId: input.ticketId, expectedVersion: input.expectedVersion, action: { type: "withdraw", kind }, actor: input.actor });
    } else if (input.choice === "continue") {
      await resume(tx, input, "interview");
    } else {
      const [cur] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
      if (!cur) throw new TicketNotFoundError();
      const target: Target = cur.targetUserId
        ? { kind: "user", userId: cur.targetUserId }
        : cur.targetGroupId
          ? { kind: "group", groupId: cur.targetGroupId }
          : null;
      const t = await performAction(tx, { ticketId: input.ticketId, expectedVersion: input.expectedVersion, action: { type: "submit", target }, actor: input.actor });
      await enqueue(tx, "ticket.summarize", { ticketId: t.id, version: t.version });
    }
    await respond(tx, turn.id, { choice: input.choice });
  });
  if (input.choice !== "resolved") kickJobs();
}
