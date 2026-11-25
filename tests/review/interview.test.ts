import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { asc, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { aiJudgments, groups, jobs, ticketReviewTurns, tickets } from "@/lib/db/schema";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import type { runRoleAgent } from "@/lib/ai/run-agent";
import { createDraft, getActorCtx } from "@/lib/tickets/service";
import {
  answerQuestions,
  FAILED_MESSAGE,
  InvalidAnswerError,
  requestReview,
  runReviewStage,
  type ReviewDeps,
} from "@/lib/review/pipeline";
import {
  DEFAULT_REQUIRED_FIELDS,
  filledKeys,
  InterviewResult,
  normalizeQuestions,
  withDisplayOptions,
  type Question,
} from "@/lib/agents/interview";
import { RecommendResult } from "@/lib/agents/recommend";

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

const q = (over: Partial<Question> & Pick<Question, "fillsKey">): Question => ({
  id: over.id ?? over.fillsKey,
  type: "single",
  prompt: `${over.fillsKey}?`,
  options: ["a", "b"],
  why: "필요해요",
  ...over,
});

describe("질문 정규화 (순수)", () => {
  test("justification 없는 text/attachment 질문은 버린다, 최대 3", () => {
    const out = normalizeQuestions(
      [
        q({ fillsKey: "steps", type: "text" }),
        q({ fillsKey: "environment" }),
        q({ fillsKey: "screenshot", type: "attachment" }),
        q({ fillsKey: "frequency", type: "scale", options: ["매번", "가끔"] }),
        q({ fillsKey: "impact", type: "multi" }),
        q({ fillsKey: "expected", type: "text", justification: "선택지로 못 물어요" }),
      ],
      { filledKeys: new Set() },
    );
    expect(out.map((x) => x.fillsKey)).toEqual(["environment", "frequency", "impact"]);
    expect(out).toHaveLength(3);
  });

  test("justification이 있는 text/attachment는 남는다", () => {
    const out = normalizeQuestions(
      [q({ fillsKey: "steps", type: "text", justification: "순서는 글로만 설명돼요" }), q({ fillsKey: "screenshot", type: "attachment", justification: "화면 문제예요" })],
      { filledKeys: new Set() },
    );
    expect(out.map((x) => x.type)).toEqual(["text", "attachment"]);
  });

  test("이미 채운 키·모르겠어요로 답한 키는 다시 묻지 않는다", () => {
    const filled = filledKeys({}, [
      { fillsKey: "environment", value: ["PC 웹"] },
      { fillsKey: "frequency", value: "unknown" },
    ]);
    expect([...filled].sort()).toEqual(["environment", "frequency"]);
    const out = normalizeQuestions(
      [q({ fillsKey: "environment" }), q({ fillsKey: "frequency" }), q({ fillsKey: "impact" })],
      { filledKeys: filled },
    );
    expect(out.map((x) => x.fillsKey)).toEqual(["impact"]);
  });

  test("같은 fillsKey 중복은 첫 번째만", () => {
    const out = normalizeQuestions([q({ id: "1", fillsKey: "impact", prompt: "첫째" }), q({ id: "2", fillsKey: "impact", prompt: "둘째" })], { filledKeys: new Set() });
    expect(out.map((x) => x.prompt)).toEqual(["첫째"]);
  });

  test("알 수 없는 fillsKey는 knownKeys가 있을 때 버린다", () => {
    const out = normalizeQuestions([q({ fillsKey: "zzz" }), q({ fillsKey: "impact" })], { filledKeys: new Set(), knownKeys: new Set(["impact"]) });
    expect(out.map((x) => x.fillsKey)).toEqual(["impact"]);
  });

  test("text/attachment 질문의 선택지는 비운다", () => {
    const [x] = normalizeQuestions([q({ fillsKey: "steps", type: "text", justification: "j", options: ["a"] })], { filledKeys: new Set() });
    expect(x.options).toBeUndefined();
  });

  test("filledKeys: 빈 답은 채운 것으로 치지 않고, 첨부는 screenshot을 채운다", () => {
    expect([...filledKeys({}, [{ fillsKey: "steps", value: "  " }, { fillsKey: "impact", value: [] }])]).toEqual([]);
    expect([...filledKeys({}, [{ fillsKey: "screenshot", value: "", attachmentUrls: ["https://x/y.png"] }])]).toEqual(["screenshot"]);
    expect([...filledKeys({ hasAttachments: true }, [])]).toEqual(["screenshot"]);
  });

  test("표시용 선택지: single/multi/scale에만 '직접 입력'·'모르겠어요'를 덧붙이고 저장 질문은 건드리지 않는다", () => {
    const base = q({ fillsKey: "environment", options: ["PC 웹", "모르겠어요"] });
    const shown = withDisplayOptions(base);
    expect(shown.options).toEqual(["PC 웹", "모르겠어요", "직접 입력"]);
    expect(base.options).toEqual(["PC 웹", "모르겠어요"]);
    expect(withDisplayOptions(q({ fillsKey: "frequency", type: "scale", options: ["매번"] })).options).toEqual(["매번", "직접 입력", "모르겠어요"]);
    expect(withDisplayOptions(q({ fillsKey: "steps", type: "text", justification: "j", options: undefined })).options).toBeUndefined();
  });

  test("기본 필요 정보 목록은 인터뷰 설계 4.1 표 그대로", () => {
    const labels = (c: keyof typeof DEFAULT_REQUIRED_FIELDS) => DEFAULT_REQUIRED_FIELDS[c].map((f) => f.label);
    expect(labels("defect")).toEqual(["재현 순서", "기대 결과", "실제 결과", "환경(기기·브라우저·앱 버전)", "빈도", "영향 범위", "스크린샷"]);
    expect(labels("improvement")).toEqual(["현재 불편", "원하는 모습", "누가·얼마나 자주 겪는지", "지금 쓰는 우회 방법"]);
    expect(labels("feature")).toEqual(["필요한 이유", "쓰는 사람", "성공 기준", "급한 정도와 이유"]);
    expect(labels("inquiry")).toEqual(["질문 내용"]);
    for (const fields of Object.values(DEFAULT_REQUIRED_FIELDS)) {
      expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
      expect(fields.some((f) => f.required)).toBe(true);
    }
  });

  test("스키마: InterviewResult / RecommendResult", () => {
    expect(InterviewResult.parse({ done: true, questions: [] })).toEqual({ done: true, questions: [] });
    expect(() => InterviewResult.parse({ done: "x" })).toThrow();
    expect(RecommendResult.parse({ target: null, reason: "", evidence: [] }).target).toBeNull();
  });
});

describe("검토 파이프라인 ③ 인터뷰, ④ 추천 (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@x.com", "리드");
    const dev = await signUp(auth, "dev@x.com", "개발");
    const req = await signUp(auth, "req@x.com", "요청자");
    const outsider = await signUp(auth, "out@x.com", "외부인");
    const { project, orgId } = await makeProject(db, auth, "iv-proj", lead.id, { isDemo: true });
    await addMember(auth, orgId, dev.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await ensureDefaultProfiles(db, project.id, lead.id);
    const [group] = await db.insert(groups).values({ projectId: project.id, name: "프론트", scopeDescription: "화면" }).returning();
    return { auth, lead, dev, req, outsider, project, group };
  }

  const ctxOf = (userId: string) => getActorCtx(db, w.project.id, userId);
  const get = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
  const turns = (id: string) => db.select().from(ticketReviewTurns).where(eq(ticketReviewTurns.ticketId, id)).orderBy(asc(ticketReviewTurns.createdAt));
  const lastTurn = async (id: string) => (await turns(id)).at(-1)!;
  const judgments = (id: string) => db.select().from(aiJudgments).where(eq(aiJudgments.ticketId, id)).orderBy(asc(aiJudgments.createdAt));
  const pendingJobs = () => db.select().from(jobs).where(eq(jobs.status, "pending")).orderBy(asc(jobs.createdAt));

  /** interview 단계 직전의 티켓. */
  async function atInterview() {
    const d = await createDraft(db, {
      projectId: w.project.id,
      authorId: w.req.id,
      title: "로그인이 안 돼요",
      body: "로그인 버튼을 누르면 아무 반응이 없어요",
      category: "defect",
      urgency: "normal",
    });
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await ctxOf(w.req.id) });
    await db.update(tickets).set({ reviewStage: "interview" }).where(eq(tickets.id, t.id));
    await db.delete(jobs);
    return t;
  }

  const run = (t: { id: string; version: number }, stage: "interview" | "recommend", d: ReviewDeps) =>
    runReviewStage(db, { ticketId: t.id, stage, version: t.version }, d);

  const Q1 = [
    { id: "x", fillsKey: "environment", type: "single", prompt: "어디서 겪으셨나요?", options: ["모바일 앱", "PC 웹"], why: "대상을 정하는 데 필요해요" },
    { id: "y", fillsKey: "frequency", type: "scale", prompt: "매번 그런가요?", options: ["매번", "가끔"], why: "빈도를 알아야 해요" },
    { id: "z", fillsKey: "steps", type: "text", prompt: "순서를 알려주세요", why: "필요해요" },
  ];

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.delete(jobs);
  });

  test("interview 1라운드: 질문 턴(round 1) + awaiting_requester, 정규화·id 부여, lead 판단 기록", async () => {
    const t = await atInterview();
    const calls: Parameters<Run>[0][] = [];
    const runner: Run = (async (opts: Parameters<Run>[0]) => {
      calls.push(opts);
      return { output: { done: false, questions: Q1 }, steps: [], usage: { inputTokens: 5, outputTokens: 6 }, traceId: null };
    }) as Run;
    await run(t, "interview", { runRoleAgent: runner });

    expect(calls).toHaveLength(1);
    expect(calls[0].system).toContain("environment");
    expect(calls[0].system).toContain("재현 순서");
    expect(calls[0].telemetry).toEqual({ projectId: w.project.id, ticketId: t.id });
    expect(calls[0].system).toContain("라운드 1");

    const after = await get(t.id);
    expect(after.status).toBe("awaiting_requester");
    expect(after.interviewRound).toBe(1);
    const turn = await lastTurn(t.id);
    expect(turn).toMatchObject({ kind: "questions", stage: "interview", round: 1 });
    const payload = turn.payload as { questions: Question[] };
    // justification 없는 text 질문은 버려진다. id는 서버가 다시 붙인다.
    expect(payload.questions.map((x) => [x.id, x.fillsKey])).toEqual([
      ["r1-q1", "environment"],
      ["r1-q2", "frequency"],
    ]);
    expect(payload.questions[0].options).toEqual(["모바일 앱", "PC 웹"]);
    const [j] = await judgments(t.id);
    expect(j).toMatchObject({ role: "lead", stage: "interview", round: 1, status: "ok", inputTokens: 5, outputTokens: 6 });
    expect(j.profileVersionId).toBeTruthy();
    expect(await pendingJobs()).toHaveLength(0);
  });

  test("질문이 없으면(done) 턴 없이 recommend 단계로 간다", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: true, questions: [] }));
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("recommend");
    expect(await turns(t.id)).toHaveLength(0);
    expect((await pendingJobs()).map((j) => j.payload)).toEqual([{ ticketId: t.id, stage: "recommend", version: after.version }]);
  });

  test("정규화 후 질문이 하나도 안 남아도 recommend로 간다", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: [Q1[2]] }));
    expect((await get(t.id)).reviewStage).toBe("recommend");
    expect(await turns(t.id)).toHaveLength(0);
  });

  test("interview LLM 실패 → 실패 카드 + awaiting_requester", async () => {
    const t = await atInterview();
    await run(t, "interview", deps(new Error("boom")));
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("failed");
    expect(turn.payload).toEqual({ message: FAILED_MESSAGE });
    expect((await judgments(t.id))[0]).toMatchObject({ role: "lead", status: "failed" });
  });

  test("interview 스키마 불일치도 실패 카드", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ nope: 1 }));
    expect((await lastTurn(t.id)).kind).toBe("failed");
  });

  test("interview 도중 제출되면 결과는 버려지고 상태를 되돌리지 않는다", async () => {
    const t = await atInterview();
    const runner: Run = (async () => {
      const cur = await get(t.id);
      const { performAction } = await import("@/lib/tickets/service");
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      return { output: { done: false, questions: Q1 }, steps: [], usage: { inputTokens: 1, outputTokens: 1 }, traceId: null };
    }) as Run;
    await run(t, "interview", { runRoleAgent: runner });
    const after = await get(t.id);
    expect(after.status).toBe("queued");
    expect(after.interviewRound).toBe(0);
    expect(await turns(t.id)).toHaveLength(0);
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
  });

  test("시작 전에 다른 단계로 넘어간 interview 작업은 버린다", async () => {
    const t = await atInterview();
    await db.update(tickets).set({ reviewStage: "recommend" }).where(eq(tickets.id, t.id));
    await run(t, "interview", deps({ done: false, questions: Q1 }));
    expect(await turns(t.id)).toHaveLength(0);
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
  });

  async function answerAll(id: string, answers: Parameters<typeof answerQuestions>[1]["answers"]) {
    const cur = await get(id);
    await answerQuestions(db, { ticketId: id, expectedVersion: cur.version, actor: await ctxOf(w.req.id), answers });
  }

  test("1라운드 답변 → continueReview + interview 재작업, 답변 저장('모르겠어요'는 unknown)", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: Q1.slice(0, 2) }));
    await db.delete(jobs);
    await answerAll(t.id, [
      { questionId: "r1-q1", value: "PC 웹" },
      { questionId: "r1-q2", value: "unknown" },
    ]);
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("interview");
    expect((await pendingJobs()).map((j) => j.payload)).toEqual([{ ticketId: t.id, stage: "interview", version: after.version }]);
    const turn = await lastTurn(t.id);
    expect(turn.respondedAt).toBeTruthy();
    expect(turn.response).toEqual({
      answers: [
        { questionId: "r1-q1", value: "PC 웹" },
        { questionId: "r1-q2", value: "unknown" },
      ],
    });
  });

  test("2라운드 답변 후에는 추천 단계로 간다(3라운드 없음)", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: [Q1[0]] }));
    await answerAll(t.id, [{ questionId: "r1-q1", value: "PC 웹" }]);
    const mid = await get(t.id);
    await run(mid, "interview", deps({ done: false, questions: [Q1[1]] }));
    const r2 = await get(t.id);
    expect(r2.interviewRound).toBe(2);
    expect((await lastTurn(t.id)).round).toBe(2);
    await db.delete(jobs);
    await answerAll(t.id, [{ questionId: "r2-q1", value: "가끔" }]);
    const after = await get(t.id);
    expect(after.status).toBe("ai_reviewing");
    expect(after.reviewStage).toBe("recommend");
    expect((await pendingJobs()).map((j) => j.payload)).toEqual([{ ticketId: t.id, stage: "recommend", version: after.version }]);
  });

  test("2라운드의 질문은 1라운드 답변으로 채운 키를 다시 묻지 않는다", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: [Q1[0], Q1[1]] }));
    await answerAll(t.id, [
      { questionId: "r1-q1", value: "PC 웹" },
      { questionId: "r1-q2", value: "unknown" },
    ]);
    const mid = await get(t.id);
    const prompts: string[] = [];
    const runner: Run = (async (o: Parameters<Run>[0]) => {
      prompts.push(o.prompt);
      return { output: { done: false, questions: [Q1[0], Q1[1], { ...Q1[0], id: "n", fillsKey: "impact", prompt: "영향 범위는?" }] }, steps: [], usage: { inputTokens: 1, outputTokens: 1 }, traceId: null };
    }) as Run;
    await run(mid, "interview", { runRoleAgent: runner });
    expect(prompts[0]).toContain("PC 웹");
    expect(prompts[0]).toContain("어디서 겪으셨나요?");
    const payload = (await lastTurn(t.id)).payload as { questions: Question[] };
    expect(payload.questions.map((x) => x.fillsKey)).toEqual(["impact"]);
  });

  test("필수 항목이 답변으로 모두 차면 LLM 호출 없이 추천으로 간다", async () => {
    const t = await atInterview();
    await db.update(tickets).set({ category: "inquiry" }).where(eq(tickets.id, t.id));
    await run(t, "interview", deps({ done: false, questions: [{ id: "a", fillsKey: "question", type: "single", prompt: "무엇이 궁금하세요?", options: ["a"], why: "w" }] }));
    await answerAll(t.id, [{ questionId: "r1-q1", value: "a" }]);
    const mid = await get(t.id);
    let called = 0;
    const runner: Run = (async () => {
      called++;
      throw new Error("호출되면 안 돼요");
    }) as Run;
    await run(mid, "interview", { runRoleAgent: runner });
    expect(called).toBe(0);
    expect((await get(t.id)).reviewStage).toBe("recommend");
  });

  test("답변 검증: 카드에 없는 질문, 빈 답변, 형식 오류, 비작성자, 낡은 version", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: [Q1[0], { ...Q1[1], type: "multi" }] }));
    const cur = await get(t.id);
    const base = { ticketId: t.id, expectedVersion: cur.version, actor: await ctxOf(w.req.id) };
    await expect(answerQuestions(db, { ...base, answers: [{ questionId: "nope", value: "a" }] })).rejects.toBeInstanceOf(InvalidAnswerError);
    await expect(answerQuestions(db, { ...base, answers: [] })).rejects.toBeInstanceOf(InvalidAnswerError);
    await expect(answerQuestions(db, { ...base, answers: [{ questionId: "r1-q2", value: "하나" }] })).rejects.toBeInstanceOf(InvalidAnswerError);
    await expect(answerQuestions(db, { ...base, answers: [{ questionId: "r1-q1", value: "  " }] })).rejects.toBeInstanceOf(InvalidAnswerError);
    await expect(answerQuestions(db, { ...base, actor: await ctxOf(w.dev.id), answers: [{ questionId: "r1-q1", value: "a" }] })).rejects.toThrow();
    await expect(answerQuestions(db, { ...base, expectedVersion: cur.version - 1, answers: [{ questionId: "r1-q1", value: "a" }] })).rejects.toThrow();
    const same = await get(t.id);
    expect(same.status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).respondedAt).toBeNull();
  });

  test("첨부 질문은 attachmentUrls로 답한다", async () => {
    const t = await atInterview();
    await run(t, "interview", deps({ done: false, questions: [{ id: "s", fillsKey: "screenshot", type: "attachment", prompt: "캡처를 올려 주세요", why: "화면 문제예요", justification: "글로는 설명이 어려워요" }] }));
    await answerAll(t.id, [{ questionId: "r1-q1", value: "", attachmentUrls: ["https://blob.example/a.png"] }]);
    expect((await get(t.id)).status).toBe("ai_reviewing");
  });

  // ---------- ④ 추천 ----------

  async function atRecommend() {
    const t = await atInterview();
    await db.update(tickets).set({ reviewStage: "recommend" }).where(eq(tickets.id, t.id));
    return t;
  }

  test("추천: 유효한 그룹 → ready 턴(대상·이유·근거) + awaiting_requester, recommender 판단", async () => {
    const t = await atRecommend();
    await run(t, "recommend", deps({ target: { kind: "group", groupId: w.group.id }, reason: "화면 문제라 프론트 그룹이에요", evidence: [] }));
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn).toMatchObject({ kind: "ready", stage: "recommend" });
    expect(turn.payload).toEqual({ target: { kind: "group", groupId: w.group.id }, reason: "화면 문제라 프론트 그룹이에요", evidence: [] });
    expect((await judgments(t.id))[0]).toMatchObject({ role: "recommender", stage: "recommend", status: "ok" });
  });

  test("추천 대상이 프로젝트에서 빠진 사람 → ready 턴의 추천은 null", async () => {
    const t = await atRecommend();
    await run(t, "recommend", deps({ target: { kind: "user", userId: w.outsider.id }, reason: "이 분이 잘 알아요", evidence: [] }));
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("ready");
    expect(turn.payload).toEqual({ target: null, reason: "", evidence: [] });
    expect((await get(t.id)).status).toBe("awaiting_requester");
  });

  test("추천 대상이 삭제된 그룹/다른 프로젝트 그룹 → null", async () => {
    const other = await makeProject(db, w.auth, "iv-other", w.lead.id, { isDemo: true });
    const [foreign] = await db.insert(groups).values({ projectId: other.project.id, name: "남의 그룹" }).returning();
    const t = await atRecommend();
    await run(t, "recommend", deps({ target: { kind: "group", groupId: foreign.id }, reason: "r", evidence: [] }));
    expect((await lastTurn(t.id)).payload).toMatchObject({ target: null });
  });

  test("추천 근거 중 없는 티켓·커밋은 제거된다", async () => {
    const t = await atRecommend();
    await run(
      t,
      "recommend",
      deps({ target: { kind: "user", userId: w.dev.id }, reason: "r", evidence: [{ ref: "ticket:00000000-0000-4000-8000-000000000000", note: "없음" }, { ref: "commit:deadbeef", note: "없음" }] }),
    );
    expect((await lastTurn(t.id)).payload).toEqual({ target: { kind: "user", userId: w.dev.id }, reason: "r", evidence: [] });
  });

  test("이유 없는 추천은 제안하지 않는다(null)", async () => {
    const t = await atRecommend();
    await run(t, "recommend", deps({ target: { kind: "user", userId: w.dev.id }, reason: "  ", evidence: [] }));
    expect((await lastTurn(t.id)).payload).toMatchObject({ target: null });
  });

  test("추천이 null이면 그대로 null", async () => {
    const t = await atRecommend();
    await run(t, "recommend", deps({ target: null, reason: "", evidence: [] }));
    expect((await lastTurn(t.id)).payload).toMatchObject({ target: null });
  });

  test.each([
    ["일반 오류", new Error("boom")],
    ["스키마 불일치", { nope: true }],
  ])("추천 실패(%s)는 failed 턴이 아니라 추천 없는 ready 턴", async (_n, outcome) => {
    const t = await atRecommend();
    await run(t, "recommend", deps(outcome));
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await lastTurn(t.id);
    expect(turn.kind).toBe("ready");
    expect(turn.payload).toEqual({ target: null, reason: "", evidence: [] });
    expect((await judgments(t.id))[0]).toMatchObject({ role: "recommender", status: "failed" });
  });

  test("recommender 프로필이 없어도 추천 없는 ready 턴으로 끝난다(갇히지 않음)", async () => {
    const bare = await makeProject(db, w.auth, "iv-bare", w.lead.id, { isDemo: true });
    const d = await createDraft(db, { projectId: bare.project.id, authorId: w.lead.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await getActorCtx(db, bare.project.id, w.lead.id) });
    await db.update(tickets).set({ reviewStage: "recommend" }).where(eq(tickets.id, t.id));
    await run(t, "recommend", deps({ target: null, reason: "", evidence: [] }));
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect((await lastTurn(t.id)).kind).toBe("ready");
  });

  test("추천 도중 제출되면 늦은 결과는 버려진다", async () => {
    const t = await atRecommend();
    const runner: Run = (async () => {
      const cur = await get(t.id);
      const { performAction } = await import("@/lib/tickets/service");
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      return { output: { target: null, reason: "", evidence: [] }, steps: [], usage: { inputTokens: 1, outputTokens: 1 }, traceId: null };
    }) as Run;
    await run(t, "recommend", { runRoleAgent: runner });
    expect((await get(t.id)).status).toBe("queued");
    expect(await turns(t.id)).toHaveLength(0);
    expect((await judgments(t.id)).map((j) => j.status)).toEqual(["discarded"]);
  });

  test("추천 도중 제출되고 LLM이 실패해도 상태를 되돌리지 않는다", async () => {
    const t = await atRecommend();
    const runner: Run = (async () => {
      const cur = await get(t.id);
      const { performAction } = await import("@/lib/tickets/service");
      await performAction(db, { ticketId: t.id, expectedVersion: cur.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req.id) });
      throw new Error("late");
    }) as Run;
    await run(t, "recommend", { runRoleAgent: runner });
    expect((await get(t.id)).status).toBe("queued");
    expect(await turns(t.id)).toHaveLength(0);
  });
});
