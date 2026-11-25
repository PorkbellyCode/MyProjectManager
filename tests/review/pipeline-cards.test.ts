import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import {
  aiJudgments,
  comments,
  domainDocs,
  jobs,
  ticketEvents,
  ticketReviewTurns,
  ticketSubscriptions,
  tickets,
} from "@/lib/db/schema";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { AgentTimeoutError, type runRoleAgent } from "@/lib/ai/run-agent";
import { addComment, EmptyCommentError } from "@/lib/comments/service";
import { ForbiddenError } from "@/lib/access";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";
import {
  AiUnavailableError,
  answerDuplicate,
  answerResolution,
  FAILED_MESSAGE,
  requestReview,
  moveStage,
  runReviewStage,
  type ReviewDeps,
} from "@/lib/review/pipeline";
import { DEDUP_CRITERIA } from "@/lib/agents/dedup";

vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));

type Run = typeof runRoleAgent;
const fakeRun =
  (...outputs: unknown[]): Run =>
  (async () => {
    const output = outputs.shift();
    if (output instanceof Error) throw output;
    return { output, steps: [], usage: { inputTokens: 3, outputTokens: 4 }, traceId: null };
  }) as Run;
const deps = (...outputs: unknown[]): ReviewDeps => ({ runRoleAgent: fakeRun(...outputs) });

const NONE_DEDUP = { candidates: [] };
const NONE_RESOLVE = { kind: "none", message: "", evidence: [] };

describe("검토 파이프라인 ①② (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@x.com", "리드");
    const dev = await signUp(auth, "dev@x.com", "개발");
    const req = await signUp(auth, "req@x.com", "요청자");
    const req2 = await signUp(auth, "req2@x.com", "요청자2");
    const outsider = await signUp(auth, "out@x.com", "외부인");
    const { project, orgId } = await makeProject(db, auth, "pipe-proj", lead.id, { isDemo: true });
    const plain = await makeProject(db, auth, "pipe-plain", lead.id);
    await addMember(auth, orgId, dev.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await addMember(auth, orgId, req2.id, "requester");
    await ensureDefaultProfiles(db, project.id, lead.id);
    return { auth, lead, dev, req, req2, outsider, project, plain: plain.project };
  }

  const ctxOf = (userId: string) => getActorCtx(db, w.project.id, userId);

  /** 제출된(대기열) 다른 티켓. */
  async function submitted(title: string, authorId = w.req2.id) {
    const t = await createDraft(db, {
      projectId: w.project.id,
      authorId,
      title,
      body: "본문",
      category: "defect",
      urgency: "normal",
    });
    return performAction(db, { ticketId: t.id, expectedVersion: t.version, action: { type: "submit", target: null }, actor: await ctxOf(authorId) });
  }

  async function reviewing(title = "로그인이 안 돼요") {
    const d = await createDraft(db, {
      projectId: w.project.id,
      authorId: w.req.id,
      title,
      body: "로그인 버튼을 누르면 아무 반응이 없어요",
      category: "defect",
      urgency: "normal",
    });
    return requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await ctxOf(w.req.id) });
  }

  const get = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
  const judgments = (id: string) => db.select().from(aiJudgments).where(eq(aiJudgments.ticketId, id)).orderBy(asc(aiJudgments.createdAt));
  const turns = (id: string) => db.select().from(ticketReviewTurns).where(eq(ticketReviewTurns.ticketId, id)).orderBy(asc(ticketReviewTurns.createdAt));
  const lastTurn = async (id: string) => (await turns(id)).at(-1)!;
  const pendingJobs = () => db.select().from(jobs).where(eq(jobs.status, "pending")).orderBy(asc(jobs.createdAt));

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.delete(jobs);
  });

  test("aiAvailable=false 프로젝트는 requestReview가 AiUnavailableError", async () => {
    const d = await createDraft(db, { projectId: w.plain.id, authorId: w.lead.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    expect(d.aiAvailable).toBe(false);
    await expect(
      requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await getActorCtx(db, w.plain.id, w.lead.id) }),
    ).rejects.toBeInstanceOf(AiUnavailableError);
    expect((await get(d.id)).status).toBe("draft");
  });

  test("requestReview: ai_reviewing + reviewStage=dedup + 작업 enqueue", async () => {
    const t = await reviewing();
    expect(t.status).toBe("ai_reviewing");
    expect(t.reviewStage).toBe("dedup");
    const [job] = await pendingJobs();
    expect(job.kind).toBe("ticket.reviewStage");
    expect(job.payload).toEqual({ ticketId: t.id, stage: "dedup", version: t.version });
  });

  test("중복 후보가 없으면 같은 작업에서 해소 확인까지 간다", async () => {
    const t = await reviewing();
    await db.delete(jobs);
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps(NONE_DEDUP, NONE_RESOLVE));
    const js = await judgments(t.id);
    expect(js.map((j) => [j.stage, j.status])).toEqual([
      ["dedup", "ok"],
      ["resolve", "ok"],
    ]);
    expect(js[0].profileVersionId).toBeTruthy();
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("interview");
    expect(await turns(t.id)).toHaveLength(0);
    const [job] = await pendingJobs();
    expect(job.payload).toEqual({ ticketId: t.id, stage: "interview", version: after.version });
  });

  test("중복 후보 카드: differences가 턴 payload에 남고, 프롬프트에 판단 기준이 들어간다", async () => {
    const origin = await submitted("결제 화면에서 오류가 나요");
    const t = await reviewing("결제 오류");
    await db.delete(jobs);
    const calls: Parameters<Run>[0][] = [];
    const run: Run = (async (opts: Parameters<Run>[0]) => {
      calls.push(opts);
      return {
        output: {
          candidates: [
            { ticketId: origin.id, reason: "증상이 같아요", differences: "발생 조건이 달라요" },
            { ticketId: "00000000-0000-4000-8000-000000000000", reason: "없는 티켓", differences: "" },
          ],
        },
        steps: [],
        usage: { inputTokens: 1, outputTokens: 1 },
        traceId: null,
      };
    }) as Run;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: run });

    expect(calls[0].system).toContain(DEDUP_CRITERIA);
    expect(calls[0].system).toContain("증상");
    expect(calls[0].system).toContain("다른 화면");
    expect(calls[0].telemetry).toEqual({ projectId: w.project.id, ticketId: t.id });
    expect(calls[0].prompt).toContain(t.id);

    const after = await get(t.id);
    expect(after.status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("duplicate_candidates");
    expect(turn.stage).toBe("dedup");
    expect(turn.judgmentId).toBeTruthy();
    expect(turn.payload).toEqual({
      candidates: [{ ticketId: origin.id, number: origin.number, title: origin.title, reason: "증상이 같아요", differences: "발생 조건이 달라요" }],
    });
    expect(await pendingJobs()).toHaveLength(0);
  });

  test("근거 없는 해소 제안은 카드 없이 interview로 넘어간다", async () => {
    const t = await reviewing();
    await db.delete(jobs);
    await runReviewStage(
      db,
      { ticketId: t.id, stage: "dedup", version: t.version },
      deps(NONE_DEDUP, { kind: "already_resolved", message: "이미 고쳐졌어요", evidence: [{ ref: "commit:deadbeef", note: "없는 커밋" }] }),
    );
    expect(await turns(t.id)).toHaveLength(0);
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("interview");
    expect((await pendingJobs()).map((j) => (j.payload as { stage: string }).stage)).toEqual(["interview"]);
  });

  async function resolutionCard() {
    const [doc] = await db.insert(domainDocs).values({ projectId: w.project.id, title: "정책", body: "로그인은 5회 실패 시 잠겨요" }).returning();
    const t = await reviewing();
    await db.update(tickets).set({ reviewStage: "resolve" }).where(eq(tickets.id, t.id));
    await runReviewStage(
      db,
      { ticketId: t.id, stage: "resolve", version: t.version },
      deps({ kind: "expected_behavior", message: "정상 동작이에요", evidence: [{ ref: `doc:${doc.id}`, note: "정책" }] }),
    );
    return t;
  }

  test("해소 카드: 근거가 유효하면 resolution 턴 + awaiting_requester", async () => {
    const t = await resolutionCard();
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn).toMatchObject({ kind: "resolution", stage: "resolve" });
    expect(turn.payload).toMatchObject({ kind: "expected_behavior", strength: "strong" });
  });

  test("같은 건이에요 → 원본에 댓글, 원본 구독, withdrawn_ai_resolved(joined_duplicate)", async () => {
    const origin = await submitted("결제 화면에서 오류가 나요");
    const t = await reviewing("결제 오류");
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps({ candidates: [{ ticketId: origin.id, reason: "같아요", differences: "" }] }));
    const cur = await get(t.id);
    await answerDuplicate(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "same", ticketIdToJoin: origin.id });

    const after = await get(t.id);
    expect(after.status).toBe("withdrawn_ai_resolved");
    expect(after.withdrawKind).toBe("joined_duplicate");
    const [c] = await db.select().from(comments).where(eq(comments.ticketId, origin.id));
    expect(c.authorId).toBe(w.req.id);
    expect(c.body.startsWith("[같은 건으로 합류] 결제 오류")).toBe(true);
    expect(c.body).toContain("로그인 버튼을 누르면 아무 반응이 없어요");
    const subs = await db.select().from(ticketSubscriptions).where(and(eq(ticketSubscriptions.ticketId, origin.id), eq(ticketSubscriptions.userId, w.req.id)));
    expect(subs).toHaveLength(1);
    const [ev] = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, origin.id), eq(ticketEvents.type, "commented")));
    expect(ev).toBeTruthy();
    const turn = await lastTurn(t.id);
    expect(turn.response).toEqual({ choice: "same", ticketId: origin.id });
    expect(turn.respondedAt).toBeTruthy();
  });

  test("같은 건이에요: 카드에 없는 티켓에는 합류할 수 없다", async () => {
    const origin = await submitted("카드에 없는 티켓");
    const other = await submitted("후보 티켓");
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps({ candidates: [{ ticketId: other.id, reason: "r", differences: "" }] }));
    const cur = await get(t.id);
    await expect(
      answerDuplicate(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "same", ticketIdToJoin: origin.id }),
    ).rejects.toThrow();
    expect((await get(t.id)).status).toBe("awaiting_requester");
  });

  test("다른 건이에요 → resolve 단계로 재개하고 작업을 enqueue", async () => {
    const origin = await submitted("결제 화면에서 오류가 나요");
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps({ candidates: [{ ticketId: origin.id, reason: "r", differences: "d" }] }));
    const cur = await get(t.id);
    await db.delete(jobs);
    await answerDuplicate(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "different" });
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("resolve");
    const [job] = await pendingJobs();
    expect(job.payload).toEqual({ ticketId: t.id, stage: "resolve", version: after.version });
    expect((await lastTurn(t.id)).response).toEqual({ choice: "different" });
  });

  test("해소 응답: 해결됐어요 → 카드 kind로 철회", async () => {
    const t = await resolutionCard();
    const cur = await get(t.id);
    await answerResolution(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "resolved" });
    const after = await get(t.id);
    expect(after.status).toBe("withdrawn_ai_resolved");
    expect(after.withdrawKind).toBe("expected_behavior");
  });

  test("해소 응답: 계속할게요 → interview 단계로 재개", async () => {
    const t = await resolutionCard();
    const cur = await get(t.id);
    await db.delete(jobs);
    await answerResolution(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "continue" });
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("interview");
    expect((await pendingJobs()).map((j) => j.payload)).toEqual([{ ticketId: t.id, stage: "interview", version: after.version }]);
  });

  test("해소 응답: 그대로 제출 → 대기열로 가고 summarize 작업", async () => {
    const t = await resolutionCard();
    const cur = await get(t.id);
    await db.delete(jobs);
    await answerResolution(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), choice: "submit" });
    expect((await get(t.id)).status).toBe("queued");
    expect((await pendingJobs()).map((j) => j.kind)).toEqual(["ticket.summarize"]);
  });

  test("요청자가 아닌 사람은 응답할 수 없고, 낡은 version은 충돌", async () => {
    const t = await resolutionCard();
    const cur = await get(t.id);
    await expect(
      answerResolution(db, { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req2.id), choice: "continue" }),
    ).rejects.toThrow();
    await expect(
      answerResolution(db, { ticketId: t.id, expectedVersion: cur.version - 1, actor: await ctxOf(w.req.id), choice: "continue" }),
    ).rejects.toThrow();
    expect((await get(t.id)).status).toBe("awaiting_requester");
  });

  test.each([
    ["일반 오류", new Error("timeout")],
    ["시간 초과", new AgentTimeoutError(60_000)],
    ["스키마 불일치", { nope: true }],
  ])("LLM 실패(%s) → awaiting_requester + 실패 턴", async (_n, outcome) => {
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: fakeRun(outcome) });
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("failed");
    expect(turn.payload).toEqual({ message: FAILED_MESSAGE });
    expect(FAILED_MESSAGE).toBe("AI 검토에 실패했어요. 그대로 제출할 수 있어요.");
    const [j] = await judgments(t.id);
    expect(j.status).toBe("failed");
    expect(j.error).toBeTruthy();
  });

  test("해소 단계 실패도 실패 카드", async () => {
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: fakeRun(NONE_DEDUP, new Error("boom")) });
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).kind).toBe("failed");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["ok", "failed"]);
  });

  test("실패 후에도 그대로 제출할 수 있다", async () => {
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: fakeRun(new Error("x")) });
    const cur = await get(t.id);
    await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
    expect((await get(t.id)).status).toBe("queued");
  });

  test("작업이 도는 중에 제출하면 늦은 결과는 discarded, 상태 유지", async () => {
    const origin = await submitted("원본");
    const t = await reviewing();
    const run: Run = (async () => {
      const cur = await get(t.id);
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      return { output: { candidates: [{ ticketId: origin.id, reason: "r", differences: "" }] }, steps: [], usage: { inputTokens: 1, outputTokens: 1 }, traceId: null };
    }) as Run;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: run });
    expect((await get(t.id)).status).toBe("queued");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
    expect(await turns(t.id)).toHaveLength(0);
  });

  test("작업이 도는 중에 제출하고 LLM이 실패해도 상태를 되돌리지 않는다", async () => {
    const t = await reviewing();
    const run: Run = (async () => {
      const cur = await get(t.id);
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      throw new Error("late failure");
    }) as Run;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: run });
    expect((await get(t.id)).status).toBe("queued");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
    expect(await turns(t.id)).toHaveLength(0);
  });

  test("작업이 도는 중에 제출하면 해소 확인으로 넘어가지도 않는다", async () => {
    const t = await reviewing();
    let calls = 0;
    const run: Run = (async () => {
      calls++;
      const cur = await get(t.id);
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      return { output: NONE_DEDUP, steps: [], usage: { inputTokens: 1, outputTokens: 1 }, traceId: null };
    }) as Run;
    await db.delete(jobs);
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: run });
    expect(calls).toBe(1);
    const after = await get(t.id);
    expect(after.status).toBe("queued");
    expect(after.reviewStage).toBe("dedup");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
    expect(await pendingJobs()).toHaveLength(0);
  });

  test("resolver 프로필이 없어도 실패 카드로 끝난다(갇히지 않음)", async () => {
    const bare = await makeProject(db, w.auth, "pipe-bare", w.lead.id, { isDemo: true });
    const d = await createDraft(db, { projectId: bare.project.id, authorId: w.lead.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await getActorCtx(db, bare.project.id, w.lead.id) });
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps(NONE_DEDUP));
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("failed");
    expect(turn.payload).toEqual({ message: FAILED_MESSAGE });
    expect(turn.judgmentId).toBeNull();
  });

  test("증거 컨텍스트 로드 오류도 실패 카드", async () => {
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, {
      ...deps(NONE_DEDUP),
      loadEvidenceCtx: async () => {
        throw new Error("db down");
      },
    });
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).kind).toBe("failed");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["failed"]);
  });

  test("해소 단계의 내부 오류도 실패 카드", async () => {
    const t = await reviewing();
    let n = 0;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, {
      ...deps(NONE_DEDUP, NONE_RESOLVE),
      loadEvidenceCtx: async (d, p) => {
        if (++n === 2) throw new Error("boom");
        return (await import("@/lib/review/normalize")).loadEvidenceCtx(d, p);
      },
    });
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).kind).toBe("failed");
  });

  test("러너가 없는 interview 단계는 실패 카드", async () => {
    const t = await reviewing();
    await db.update(tickets).set({ reviewStage: "interview" }).where(eq(tickets.id, t.id));
    await runReviewStage(db, { ticketId: t.id, stage: "interview", version: t.version }, deps());
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).kind).toBe("failed");
  });

  test("이미 resolve로 넘어간 티켓에 dedup 작업이 다시 오면 discarded, 카드·작업 없음", async () => {
    const t = await reviewing();
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, deps(NONE_DEDUP, NONE_RESOLVE));
    await db.delete(jobs);
    const before = (await judgments(t.id)).length;
    let called = false;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version }, { runRoleAgent: (async () => { called = true; }) as unknown as Run });
    expect(called).toBe(false);
    const js = await judgments(t.id);
    expect(js).toHaveLength(before + 1);
    expect(js.at(-1)!.status).toBe("discarded");
    expect(await turns(t.id)).toHaveLength(0);
    expect(await pendingJobs()).toHaveLength(0);
    expect((await get(t.id)).reviewStage).toBe("interview");
  });

  test("moveStage: from이 다르면 아무것도 바꾸지 않는다", async () => {
    const t = await reviewing();
    await expect(db.transaction((tx) => moveStage(tx, { id: t.id, reviewStage: "resolve" }, t.version, "interview"))).rejects.toThrow();
    expect((await get(t.id)).reviewStage).toBe("dedup");
    await db.transaction((tx) => moveStage(tx, { id: t.id, reviewStage: "dedup" }, t.version, "resolve"));
    expect((await get(t.id)).reviewStage).toBe("resolve");
  });

  test("시작 시 version이 다르면 아무것도 바꾸지 않고 discarded만 남긴다", async () => {
    const t = await reviewing();
    let called = false;
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: t.version - 1 }, { runRoleAgent: (async () => { called = true; }) as unknown as Run });
    expect(called).toBe(false);
    expect((await get(t.id)).status).toBe("ai_reviewing");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
  });

  test("시작 시 ai_reviewing이 아니면(이미 제출) discarded만 남긴다", async () => {
    const t = await reviewing();
    const cur = await get(t.id);
    await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
    const now = await get(t.id);
    await runReviewStage(db, { ticketId: t.id, stage: "dedup", version: now.version }, deps(NONE_DEDUP));
    expect((await get(t.id)).status).toBe("queued");
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
  });
});

describe("addComment (최소판, Task 11이 확장)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  test("멤버 검사·빈 본문 거부·commented 이벤트", async () => {
    const auth = createAuth(db);
    const lead = await signUp(auth, "l@x.com", "리드");
    const out = await signUp(auth, "o@x.com", "외부");
    const { project } = await makeProject(db, auth, "cm-proj", lead.id);
    const t = await createDraft(db, { projectId: project.id, authorId: lead.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    await expect(addComment(db, { ticketId: t.id, authorId: lead.id, body: "   " })).rejects.toBeInstanceOf(EmptyCommentError);
    await expect(addComment(db, { ticketId: t.id, authorId: out.id, body: "hi" })).rejects.toBeInstanceOf(ForbiddenError);
    const c = await addComment(db, { ticketId: t.id, authorId: lead.id, body: " 안녕 " });
    expect(c.body).toBe("안녕");
    const evs = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "commented")));
    expect(evs).toHaveLength(1);
  });
});
