import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { aiJudgments, ticketEvents, ticketReviewTurns, tickets } from "@/lib/db/schema";
import type { JudgmentStatus } from "@/lib/db/schema/ai";
import type { ReviewTurnKind } from "@/lib/db/schema/review";
import type { ReviewStage, WithdrawKind } from "@/lib/db/schema/tickets";
import { getActiveProfile, type AgentProfile, type AgentRole } from "@/lib/agents/profiles";
import { buildTools } from "@/lib/agents/tools";
import { dedupSchema, dedupSystem } from "@/lib/agents/dedup";
import { resolveSchema, resolveSystem } from "@/lib/agents/resolve";
import {
  assignQuestionIds,
  filledKeys,
  interviewSystem,
  InterviewResult,
  MAX_ROUNDS,
  normalizeQuestions,
  type Question,
} from "@/lib/agents/interview";
import { NO_RECOMMENDATION, normalizeRecommendation, RecommendResult, recommendSystem, type Recommendation } from "@/lib/agents/recommend";
import { runRoleAgent as defaultRunRoleAgent, type RunRoleAgentResult } from "@/lib/ai/run-agent";
import { addComment } from "@/lib/comments/service";
import { enqueue, kickJobs } from "@/lib/jobs/queue";
import { loadEvidenceCtx, normalizeDedup, normalizeResolve } from "@/lib/review/normalize";
import {
  getRequiredFields,
  loadAnswered,
  renderAnswered,
  ticketHasAttachments,
  type AnswerRecord,
  type QuestionsPayload,
} from "@/lib/review/records";
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

export class InvalidAnswerError extends Error {
  constructor(message = "답변 형식이 맞지 않아요. 다시 확인해 주세요.") {
    super(message);
    this.name = "InvalidAnswerError";
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
  /** 테스트용 주입. */
  loadEvidenceCtx?: typeof loadEvidenceCtx;
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
export async function moveStage(tx: Tx, t: { id: string; reviewStage: ReviewStage | null }, version: number, to: ReviewStage) {
  const rows = await tx
    .update(tickets)
    .set({ reviewStage: to, updatedAt: new Date() })
    .where(
      and(
        eq(tickets.id, t.id),
        eq(tickets.version, version),
        eq(tickets.status, "ai_reviewing"),
        t.reviewStage === null ? isNull(tickets.reviewStage) : eq(tickets.reviewStage, t.reviewStage),
      ),
    )
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

export const ticketPrompt = (t: Ticket) =>
  [`검토 중인 티켓 id: ${t.id}`, `제목: ${t.title}`, `분류: ${t.category}`, `긴급도: ${t.urgency}`, "", "본문:", t.body].join("\n");

export type JudgmentBase = {
  projectId: string;
  ticketId: string;
  /** 검토 단계 밖의 판단(정리본)은 null. */
  stage: ReviewStage | null;
  role: AgentRole;
  round?: number | null;
  /** 프로필이 없으면(조회 실패) null. 이때는 판단 행을 남기지 않는다. */
  profile: AgentProfile | null;
  input: unknown;
};

export async function insertJudgment(
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
  if (!base.profile) return null;
  const [j] = await tx
    .insert(aiJudgments)
    .values({
      ticketId: base.ticketId,
      projectId: base.projectId,
      role: base.role,
      stage: base.stage,
      round: base.round ?? null,
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

const insertTurn = (
  tx: Tx,
  ticketId: string,
  stage: ReviewStage,
  kind: ReviewTurnKind,
  payload: unknown,
  judgmentId: string | null,
  round: number | null = null,
) => tx.insert(ticketReviewTurns).values({ ticketId, stage, round, kind, payload, judgmentId });

type StageOutcome = "proceed" | "stop";

const roleFor = (stage: ReviewStage): AgentRole => (stage === "interview" ? "lead" : stage === "recommend" ? "recommender" : "resolver");

/**
 * 한 단계를 실행한다. 중복 확인과 해소 확인은 resolver, 인터뷰는 lead, 추천은 recommender 프로필을 쓴다(dedup 전용 역할이 없다).
 * 결과는 같은 트랜잭션 안에서 티켓 version을 다시 확인한 뒤에만 반영한다. 그 사이 티켓이 바뀌었으면 판단만 `discarded`로 남긴다.
 * 오류는 어느 단계든 티켓을 가두지 않는다: 실패 카드(추천은 추천 없는 `ready` 카드) + awaiting_requester.
 */
export async function runReviewStage(
  db: Db,
  job: { ticketId: string; stage: ReviewStage; version: number },
  deps: ReviewDeps = {},
): Promise<void> {
  const [t0] = await db.select().from(tickets).where(eq(tickets.id, job.ticketId));
  if (!t0) return;
  let profile: AgentProfile | null = null;
  let profileError: unknown = null;
  try {
    profile = await getActiveProfile(db, t0.projectId, roleFor(job.stage));
  } catch (e) {
    profileError = e;
  }
  const base = (stage: ReviewStage): JudgmentBase & { stage: ReviewStage } => ({
    projectId: t0.projectId,
    ticketId: t0.id,
    stage,
    role: roleFor(stage),
    round: stage === "interview" ? t0.interviewRound + 1 : null,
    profile,
    input: { title: t0.title, body: t0.body, category: t0.category, urgency: t0.urgency },
  });

  // 이미 다른 단계로 넘어갔거나(재시도·회수된 작업), 제출 등으로 바뀐 티켓은 건드리지 않는다.
  if (t0.status !== "ai_reviewing" || t0.version !== job.version || t0.reviewStage !== job.stage) {
    await insertJudgment(db, base(job.stage), { status: "discarded", error: "검토 시작 전에 티켓이 바뀌었어요." });
    return;
  }

  // 여기부터는 어떤 오류든 티켓을 ai_reviewing에 가두지 않는다.
  const failJob = { ticketId: t0.id, version: job.version };
  let current: ReviewStage = job.stage;
  try {
    if (!profile) throw profileError ?? new Error(`에이전트 프로필이 없어요: ${roleFor(job.stage)}`);
    if (job.stage === "interview") {
      await runInterviewStage(db, t0, job.version, profile, base("interview"), deps);
    } else if (job.stage === "recommend") {
      await runRecommendStage(db, t0, job.version, profile, base("recommend"), deps);
    } else {
      if (job.stage === "dedup") {
        const outcome = await runDedupStage(db, t0, job.version, profile, base("dedup"), deps);
        if (outcome === "stop") return;
        current = "resolve";
      }
      await runResolveStage(db, t0, job.version, profile, base("resolve"), deps);
    }
  } catch (err) {
    if (job.stage === "recommend") await recordRecommendFallback(db, failJob, base("recommend"), err);
    else await recordFailure(db, failJob, base(current), err);
  }
}

type Run = Awaited<ReturnType<typeof defaultRunRoleAgent>>;

export async function invoke<T>(
  db: Db,
  t: Ticket,
  profile: AgentProfile,
  system: string,
  schema: z.ZodType<T>,
  deps: ReviewDeps,
  prompt: string = ticketPrompt(t),
): Promise<Run & { parsed: T }> {
  const run = deps.runRoleAgent ?? defaultRunRoleAgent;
  const res = await run({
    profile,
    system,
    prompt,
    tools: buildTools({ db, projectId: t.projectId, ticketId: t.id }),
    schema: schema as z.ZodType<unknown>,
    telemetry: { projectId: t.projectId, ticketId: t.id },
    timeoutMs: deps.timeoutMs,
  });
  // 주입된 실행기나 모델이 스키마를 어겨도 여기서 막는다.
  return { ...res, parsed: schema.parse(res.output) };
}

/** 실패 카드 + stageFailed. 그 사이 티켓이 바뀌었으면 실패 카드 대신 discarded만 남긴다. */
async function recordFailure(db: Db, job: { ticketId: string; version: number }, b: JudgmentBase & { stage: ReviewStage }, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "failed", error: message });
      await insertTurn(tx, job.ticketId, b.stage, "failed", { message: FAILED_MESSAGE }, j?.id ?? null);
      await performAction(tx, { ticketId: job.ticketId, expectedVersion: job.version, action: { type: "stageFailed" }, actor: SYSTEM });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", error: message });
  }
}

/** 중복 후보를 찾는다(요청자에게 보여 줄 카드 내용까지). 상태는 건드리지 않는다. */
export async function checkDuplicates(db: Db, t: Ticket, profile: AgentProfile, deps: ReviewDeps) {
  const res = await invoke(db, t, profile, dedupSystem(profile.instructions), dedupSchema, deps);
  const ctx = await (deps.loadEvidenceCtx ?? loadEvidenceCtx)(db, t.projectId);
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
  return { run: res, payload, ids };
}

/** 해소 여부를 확인한다. 근거가 없으면 normalized가 null. 상태는 건드리지 않는다. */
export async function checkResolution(db: Db, t: Ticket, profile: AgentProfile, deps: ReviewDeps) {
  const res = await invoke(db, t, profile, resolveSystem(profile.instructions), resolveSchema, deps);
  const ctx = await (deps.loadEvidenceCtx ?? loadEvidenceCtx)(db, t.projectId);
  const normalized = normalizeResolve(res.parsed, ctx, t.id);
  return { run: res, normalized };
}

/** 추천 대상을 정한다. 프로젝트에 없는 대상·이유 없는 추천은 null. 상태는 건드리지 않는다. */
export async function checkRecommendation(db: Db, t: Ticket, profile: AgentProfile, deps: ReviewDeps) {
  const answered = await loadAnswered(db, t.id);
  const prompt = [ticketPrompt(t), "", "## 인터뷰 기록", renderAnswered(answered)].join("\n");
  const res = await invoke(db, t, profile, recommendSystem(profile.instructions), RecommendResult, deps, prompt);
  const ctx = await (deps.loadEvidenceCtx ?? loadEvidenceCtx)(db, t.projectId);
  const rec = await normalizeRecommendation(db, t.projectId, res.parsed, ctx, t.id);
  return { run: res, rec };
}

async function runDedupStage(db: Db, t: Ticket, version: number, profile: AgentProfile, b: JudgmentBase, deps: ReviewDeps): Promise<StageOutcome> {
  const { run: res, payload, ids } = await checkDuplicates(db, t, profile, deps);
  const done = { output: res.output, normalized: payload, evidence: ids.map((id) => ({ ref: `ticket:${id}` })), run: res };

  try {
    return await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      if (payload.candidates.length > 0) {
        await insertTurn(tx, t.id, "dedup", "duplicate_candidates", payload, j!.id);
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
  const { run: res, normalized } = await checkResolution(db, t, profile, deps);
  const done = { output: res.output, normalized, evidence: normalized?.evidence ?? [], run: res };

  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      if (normalized) {
        await insertTurn(tx, t.id, "resolve", "resolution", normalized, j!.id);
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

/** 인터뷰 단계가 끝나 추천 단계로 넘어간다. 그 사이 티켓이 바뀌었으면 아무것도 하지 않는다. */
async function toRecommend(db: Db, t: Ticket, version: number): Promise<void> {
  try {
    await db.transaction(async (tx) => {
      await moveStage(tx, t, version, "recommend");
      await enqueue(tx, "ticket.reviewStage", { ticketId: t.id, stage: "recommend", version });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    return;
  }
  kickJobs();
}

/**
 * ③ 인터뷰 라운드(리드 혼자). `interviewRound + 1`번째 라운드의 질문을 만든다.
 * 질문이 있으면 `questions` 턴 + stageReady, 질문이 없거나 done이거나 2라운드가 끝났으면 추천 단계로 간다.
 */
async function runInterviewStage(db: Db, t: Ticket, version: number, profile: AgentProfile, b: JudgmentBase, deps: ReviewDeps): Promise<void> {
  const fields = await getRequiredFields(db, t.projectId, t.category);
  const answered = await loadAnswered(db, t.id);
  const filled = filledKeys({ hasAttachments: await ticketHasAttachments(db, t.id) }, answered);
  const requiredDone = fields.filter((f) => f.required).every((f) => filled.has(f.key));
  // 3라운드는 없다. 답변으로 필수 항목이 다 찼으면 모델을 부르지 않고 끝낸다.
  if (t.interviewRound >= MAX_ROUNDS || (answered.length > 0 && requiredDone)) {
    await toRecommend(db, t, version);
    return;
  }

  const round = t.interviewRound + 1;
  const prompt = [ticketPrompt(t), "", "## 지금까지의 인터뷰", renderAnswered(answered)].join("\n");
  const res = await invoke(db, t, profile, interviewSystem(profile.instructions, { round, fields, filled }), InterviewResult, deps, prompt);
  const questions: Question[] = assignQuestionIds(
    normalizeQuestions(res.parsed.questions as Question[], { filledKeys: filled, knownKeys: new Set(fields.map((f) => f.key)) }),
    round,
  );
  const asks = !res.parsed.done && questions.length > 0;
  const done = { output: res.output, normalized: { round, done: !asks, questions }, evidence: [], run: res };

  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      // 같은 version에서 라운드만 올린다. 그 사이 티켓이 바뀌었으면 StaleError.
      const rows = await tx
        .update(tickets)
        .set({ interviewRound: round, updatedAt: new Date() })
        .where(and(eq(tickets.id, t.id), eq(tickets.version, version), eq(tickets.status, "ai_reviewing"), eq(tickets.reviewStage, "interview")))
        .returning({ id: tickets.id });
      if (rows.length === 0) throw new StaleError();
      if (asks) {
        await insertTurn(tx, t.id, "interview", "questions", { round, questions } satisfies QuestionsPayload, j!.id, round);
        await performAction(tx, { ticketId: t.id, expectedVersion: version, action: { type: "stageReady" }, actor: SYSTEM });
        return;
      }
      await moveStage(tx, t, version, "recommend");
      await enqueue(tx, "ticket.reviewStage", { ticketId: t.id, stage: "recommend", version });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", ...done });
    return;
  }
  if (!asks) kickJobs();
}

/** ④ 대상 추천. 결과는 `ready` 턴(추천 대상·이유·근거)이고, 추천이 없어도 같은 턴이다. */
async function runRecommendStage(db: Db, t: Ticket, version: number, profile: AgentProfile, b: JudgmentBase, deps: ReviewDeps): Promise<void> {
  const { run: res, rec } = await checkRecommendation(db, t, profile, deps);
  const done = { output: res.output, normalized: rec, evidence: rec.evidence, run: res };
  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "ok", ...done });
      await insertTurn(tx, t.id, "recommend", "ready", rec, j!.id);
      await performAction(tx, { ticketId: t.id, expectedVersion: version, action: { type: "stageReady" }, actor: SYSTEM });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", ...done });
  }
}

/** 추천 실패는 실패 카드가 아니라 추천 없는 `ready` 카드다(요청자는 그대로 대상을 고르면 된다). */
async function recordRecommendFallback(db: Db, job: { ticketId: string; version: number }, b: JudgmentBase, err: unknown): Promise<void> {
  const message = err instanceof Error ? err.message : String(err);
  try {
    await db.transaction(async (tx) => {
      const j = await insertJudgment(tx, b, { status: "failed", error: message });
      await insertTurn(tx, job.ticketId, "recommend", "ready", NO_RECOMMENDATION satisfies Recommendation, j?.id ?? null);
      await performAction(tx, { ticketId: job.ticketId, expectedVersion: job.version, action: { type: "stageReady" }, actor: SYSTEM });
    });
  } catch (e) {
    if (!isStale(e)) throw e;
    await insertJudgment(db, b, { status: "discarded", error: message });
  }
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

// ---------- ③ 인터뷰 응답 ----------

export type AnswerInput = { questionId: string; value: string | string[] | "unknown"; attachmentUrls?: string[] };

const nonBlank = (x: unknown): x is string => typeof x === "string" && x.trim() !== "";

function cleanAnswer(q: Question, a: AnswerInput): AnswerRecord {
  const urls = (a.attachmentUrls ?? []).filter(nonBlank);
  if (a.attachmentUrls && urls.length !== a.attachmentUrls.length) throw new InvalidAnswerError();
  const attach = urls.length ? { attachmentUrls: urls } : {};
  if (a.value === "unknown") return { questionId: q.id, value: "unknown", ...attach };
  switch (q.type) {
    case "attachment":
      if (urls.length === 0) throw new InvalidAnswerError("첨부 파일을 올려 주세요.");
      return { questionId: q.id, value: typeof a.value === "string" ? a.value.trim() : "", ...attach };
    case "multi":
      if (!Array.isArray(a.value) || a.value.length === 0 || !a.value.every(nonBlank)) throw new InvalidAnswerError();
      return { questionId: q.id, value: a.value.map((v) => v.trim()), ...attach };
    default:
      if (!nonBlank(a.value)) throw new InvalidAnswerError();
      return { questionId: q.id, value: a.value.trim(), ...attach };
  }
}

/**
 * 질문 카드에 답한다. 답은 질문마다 하나(모르겠어요는 'unknown'). 답한 질문만 저장하고, 안 답한 질문은 채워지지 않은 채로 남는다.
 * 라운드가 2보다 작으면 다음 질문 라운드, 아니면 추천 단계로 재개한다.
 */
export async function answerQuestions(db: Db, input: AnswerBase & { answers: AnswerInput[] }): Promise<void> {
  await db.transaction(async (tx) => {
    const turn = await openTurn(tx, input.ticketId, "questions");
    const { questions } = turn.payload as QuestionsPayload;
    if (input.answers.length === 0) throw new InvalidAnswerError("답변을 하나 이상 입력해 주세요.");
    const seen = new Set<string>();
    const answers = input.answers.map((a) => {
      const q = questions.find((x) => x.id === a.questionId);
      if (!q || seen.has(q.id)) throw new InvalidAnswerError("카드에 없는 질문이에요.");
      seen.add(q.id);
      return cleanAnswer(q, a);
    });
    const [cur] = await tx.select({ round: tickets.interviewRound }).from(tickets).where(eq(tickets.id, input.ticketId));
    if (!cur) throw new TicketNotFoundError();
    await resume(tx, input, cur.round < MAX_ROUNDS ? "interview" : "recommend");
    await respond(tx, turn.id, { answers });
  });
  kickJobs();
}

// ---------- ⑤ 제출 ----------

/**
 * 제출. draft·ai_reviewing·awaiting_requester 어디서든 가능하다(AI는 제출을 막지 않는다).
 * - 추천 카드가 있었다면 이벤트 `target_recommendation`에 추천 대상과 최종 선택을 둘 다 남긴다.
 * - AI를 쓸 수 있는 티켓만 후속 작업을 만든다: 초안에서 바로 낸 제출은 조용한 검토(`ticket.silentReview`), 검토를 거친 제출은 정리본(`ticket.summarize`).
 * - 검토 중에 제출하면 진행 중인 작업의 결과는 version 확인에서 버려진다.
 */
export async function submitTicket(db: Db, input: AnswerBase & { target: Target }): Promise<Ticket> {
  const target: Target = input.target ?? null;
  const updated = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
    if (!before) throw new TicketNotFoundError();
    const t = await performAction(tx, { ticketId: input.ticketId, expectedVersion: input.expectedVersion, action: { type: "submit", target }, actor: input.actor });

    const [rec] = await tx
      .select()
      .from(ticketReviewTurns)
      .where(and(eq(ticketReviewTurns.ticketId, t.id), eq(ticketReviewTurns.stage, "recommend"), eq(ticketReviewTurns.kind, "ready")))
      .orderBy(desc(ticketReviewTurns.createdAt))
      .limit(1);
    if (rec) {
      const recommended = (rec.payload as Recommendation).target ?? null;
      await tx.insert(ticketEvents).values({
        ticketId: t.id,
        actorId: input.actor.userId,
        actorKind: "user",
        type: "target_recommendation",
        from: { target: recommended },
        to: { target },
      });
      if (!rec.respondedAt) await respond(tx, rec.id, { target });
    }

    if (before.aiAvailable) {
      if (before.status === "draft") await enqueue(tx, "ticket.silentReview", { ticketId: t.id });
      else await enqueue(tx, "ticket.summarize", { ticketId: t.id, version: t.version });
    }
    return t;
  });
  if (updated.aiAvailable) kickJobs();
  return updated;
}
