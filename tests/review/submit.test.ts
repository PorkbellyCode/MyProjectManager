import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import {
  aiJudgments,
  groups,
  jobs,
  notifications,
  ticketEvents,
  ticketReviewTurns,
  ticketSummaries,
  tickets,
} from "@/lib/db/schema";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import type { runRoleAgent } from "@/lib/ai/run-agent";
import { ForbiddenError } from "@/lib/access";
import { createDraft, getActorCtx, performAction, TicketNotFoundError } from "@/lib/tickets/service";
import { InvalidTargetError } from "@/lib/tickets/targets";
import { answerQuestions, requestReview, runReviewStage, submitTicket, type ReviewDeps } from "@/lib/review/pipeline";
import { editSummary, summarizeTicket, SummaryNotEditableError } from "@/lib/review/summary";
import { runSilentReview } from "@/lib/review/silent";
import { handlers } from "@/lib/jobs/handlers";

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
const NONE_REC = { target: null, reason: "", evidence: [] };

describe("제출, 정리본, 바로 제출 (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@x.com", "리드");
    const dev = await signUp(auth, "dev@x.com", "개발");
    const dev2 = await signUp(auth, "dev2@x.com", "개발2");
    const req = await signUp(auth, "req@x.com", "요청자");
    const req2 = await signUp(auth, "req2@x.com", "요청자2");
    const { project, orgId } = await makeProject(db, auth, "sub-proj", lead.id, { isDemo: true });
    const plain = await makeProject(db, auth, "sub-plain", lead.id);
    await addMember(auth, orgId, dev.id, "developer");
    await addMember(auth, orgId, dev2.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await addMember(auth, orgId, req2.id, "requester");
    await ensureDefaultProfiles(db, project.id, lead.id);
    const [group] = await db.insert(groups).values({ projectId: project.id, name: "프론트", scopeDescription: "화면" }).returning();
    return { auth, lead, dev, dev2, req, req2, project, plain: plain.project, group };
  }

  const ctxOf = (userId: string) => getActorCtx(db, w.project.id, userId);
  const get = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
  const events = (id: string, type?: string) =>
    db
      .select()
      .from(ticketEvents)
      .where(type ? and(eq(ticketEvents.ticketId, id), eq(ticketEvents.type, type)) : eq(ticketEvents.ticketId, id))
      .orderBy(asc(ticketEvents.createdAt));
  const turns = (id: string) => db.select().from(ticketReviewTurns).where(eq(ticketReviewTurns.ticketId, id)).orderBy(asc(ticketReviewTurns.createdAt));
  const judgments = (id: string) => db.select().from(aiJudgments).where(eq(aiJudgments.ticketId, id)).orderBy(asc(aiJudgments.createdAt));
  const pendingJobs = () => db.select().from(jobs).where(eq(jobs.status, "pending")).orderBy(asc(jobs.createdAt));
  const summaryOf = async (id: string) => (await db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, id)))[0];

  const draft = (over: Partial<Parameters<typeof createDraft>[1]> = {}) =>
    createDraft(db, {
      projectId: w.project.id,
      authorId: w.req.id,
      title: "로그인이 안 돼요",
      body: "로그인 버튼을 누르면 아무 반응이 없어요",
      category: "defect",
      urgency: "high",
      ...over,
    });

  async function submittedOther(title: string) {
    const t = await draft({ title, authorId: w.req2.id });
    return performAction(db, { ticketId: t.id, expectedVersion: t.version, action: { type: "submit", target: null }, actor: await ctxOf(w.req2.id) });
  }

  /** 추천까지 끝나 awaiting_requester인 티켓. */
  async function readyTicket(rec: unknown = { target: { kind: "group", groupId: w.group.id }, reason: "화면 문제예요", evidence: [] }) {
    const d = await draft();
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await ctxOf(w.req.id) });
    await db.update(tickets).set({ reviewStage: "recommend" }).where(eq(tickets.id, t.id));
    await runReviewStage(db, { ticketId: t.id, stage: "recommend", version: t.version }, deps(rec));
    await db.delete(jobs);
    return get(t.id);
  }

  const submit = async (t: { id: string; version: number }, target: Parameters<typeof submitTicket>[1]["target"], by = w.req.id) =>
    submitTicket(db, { ticketId: t.id, expectedVersion: t.version, actor: await ctxOf(by), target });

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.delete(jobs);
  });

  // ---------- 제출 ----------

  test("추천과 다른 대상으로 제출 → target_recommendation 이벤트에 둘 다, summarize 작업", async () => {
    const t = await readyTicket();
    const after = await submit(t, { kind: "user", userId: w.dev.id });
    expect(after.status).toBe("assigned");
    expect(after.targetUserId).toBe(w.dev.id);
    const [ev] = await events(t.id, "target_recommendation");
    expect(ev.actorId).toBe(w.req.id);
    expect(ev.from).toEqual({ target: { kind: "group", groupId: w.group.id } });
    expect(ev.to).toEqual({ target: { kind: "user", userId: w.dev.id } });
    expect((await pendingJobs()).map((j) => [j.kind, j.payload])).toEqual([["ticket.summarize", { ticketId: t.id, version: after.version }]]);
    const ready = (await turns(t.id)).find((x) => x.kind === "ready")!;
    expect(ready.respondedAt).toBeTruthy();
  });

  test("추천을 그대로 받아들이면 같은 값으로 기록(적중)", async () => {
    const t = await readyTicket();
    await submit(t, { kind: "group", groupId: w.group.id });
    const [ev] = await events(t.id, "target_recommendation");
    expect(ev.from).toEqual(ev.to);
    expect((await get(t.id)).status).toBe("queued");
  });

  test("추천이 없던 티켓(null)은 null → 선택으로 기록", async () => {
    const t = await readyTicket(NONE_REC);
    await submit(t, null);
    const [ev] = await events(t.id, "target_recommendation");
    expect(ev.from).toEqual({ target: null });
    expect(ev.to).toEqual({ target: null });
  });

  test("바로 제출(초안): silentReview 작업, 추천 이벤트 없음", async () => {
    const d = await draft();
    const after = await submit(d, null);
    expect(after.status).toBe("queued");
    expect((await pendingJobs()).map((j) => [j.kind, j.payload])).toEqual([["ticket.silentReview", { ticketId: d.id }]]);
    expect(await events(d.id, "target_recommendation")).toHaveLength(0);
  });

  test("AI 검토 중 제출도 성공하고 summarize 작업이 생긴다", async () => {
    const d = await draft();
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await ctxOf(w.req.id) });
    await db.delete(jobs);
    const after = await submit(t, null);
    expect(after.status).toBe("queued");
    expect((await pendingJobs()).map((j) => j.kind)).toEqual(["ticket.summarize"]);
  });

  test("AI를 쓸 수 없는 프로젝트의 제출은 AI 작업을 만들지 않는다", async () => {
    const d = await createDraft(db, { projectId: w.plain.id, authorId: w.lead.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    expect(d.aiAvailable).toBe(false);
    const after = await submitTicket(db, { ticketId: d.id, expectedVersion: d.version, actor: await getActorCtx(db, w.plain.id, w.lead.id), target: null });
    expect(after.status).toBe("queued");
    expect(await pendingJobs()).toHaveLength(0);
    expect(await events(d.id, "target_recommendation")).toHaveLength(0);
  });

  test("프로젝트에 없는 대상은 거부, 아무것도 바뀌지 않는다", async () => {
    const t = await readyTicket();
    await expect(submit(t, { kind: "user", userId: w.req.id })).rejects.toBeInstanceOf(InvalidTargetError);
    expect((await get(t.id)).status).toBe("awaiting_requester");
    expect(await pendingJobs()).toHaveLength(0);
    expect(await events(t.id, "target_recommendation")).toHaveLength(0);
  });

  test("작성자만, 낡은 version은 충돌", async () => {
    const t = await readyTicket();
    await expect(submit(t, null, w.req2.id)).rejects.toThrow();
    await expect(submit({ id: t.id, version: t.version - 1 }, null)).rejects.toThrow();
    expect((await get(t.id)).status).toBe("awaiting_requester");
  });

  // ---------- 정리본 ----------

  const SUMMARY = {
    summary: "로그인 버튼이 반응하지 않아요.",
    fields: { steps: "로그인 버튼 클릭", expected: "로그인됨", actual: null, environment: "무시됨", frequency: "알 수 없음", zzz: "목록에 없는 키" },
    fillRate: 0.99,
    urgencyNote: "요청자가 긴급도를 높음으로 표시했어요",
  };

  async function interviewed() {
    const d = await draft();
    const t = await requestReview(db, { ticketId: d.id, expectedVersion: d.version, actor: await ctxOf(w.req.id) });
    await db.update(tickets).set({ reviewStage: "interview" }).where(eq(tickets.id, t.id));
    await runReviewStage(
      db,
      { ticketId: t.id, stage: "interview", version: t.version },
      deps({
        done: false,
        questions: [
          { id: "a", fillsKey: "environment", type: "single", prompt: "어디서 겪으셨나요?", options: ["PC 웹"], why: "w" },
          { id: "b", fillsKey: "frequency", type: "scale", prompt: "매번 그런가요?", options: ["매번"], why: "w" },
        ],
      }),
    );
    const cur = await get(t.id);
    await answerQuestions(db, {
      ticketId: t.id,
      expectedVersion: cur.version,
      actor: await ctxOf(w.req.id),
      answers: [
        { questionId: "r1-q1", value: "PC 웹" },
        { questionId: "r1-q2", value: "unknown" },
      ],
    });
    return submit(await get(t.id), null);
  }

  test("정리본: 인터뷰 기록이 있으면 interview, 긴급도는 그대로, 채움률·알 수 없음은 코드가 정한다", async () => {
    const t = await interviewed();
    const calls: Parameters<Run>[0][] = [];
    const runner: Run = (async (o: Parameters<Run>[0]) => {
      calls.push(o);
      return { output: SUMMARY, steps: [], usage: { inputTokens: 7, outputTokens: 8 }, traceId: null };
    }) as Run;
    await summarizeTicket(db, t.id, { runRoleAgent: runner });

    expect(calls[0].prompt).toContain("PC 웹");
    expect(calls[0].prompt).toContain("어디서 겪으셨나요?");
    const s = await summaryOf(t.id);
    expect(s.generatedFrom).toBe("interview");
    expect(s.editedBy).toBeNull();
    expect(s.editedAt).toBeNull();
    const data = s.data as { fields: Record<string, string | null>; fillRate: number; urgencyNote: string | null };
    // 인터뷰에서 모르겠어요로 답한 키는 알 수 없음, 목록에 없는 키는 버림
    expect(data.fields.frequency).toBe("알 수 없음");
    expect(data.fields).not.toHaveProperty("zzz");
    // 필수(재현 순서, 기대 결과, 실제 결과, 환경) 중 값이 있는 것: steps, expected, environment → 3/4
    expect(data.fillRate).toBe(0.75);
    expect(data.urgencyNote).toBe("요청자가 긴급도를 높음으로 표시했어요");
    expect(s.markdown).toContain("로그인 버튼이 반응하지 않아요.");
    expect(s.markdown).toContain("재현 순서");
    expect(s.markdown).toContain("알 수 없음");
    expect(s.markdown).toContain("75%");
    expect(s.markdown).toContain("긴급도 참고");
    expect(s.markdown).not.toContain("인터뷰 없이 제출됨");
    // 긴급도는 요청자가 정한 값 그대로, 대상·상태도 그대로
    const after = await get(t.id);
    expect(after.urgency).toBe("high");
    expect(after.status).toBe("queued");
    const [j] = (await judgments(t.id)).filter((x) => x.role === "summarizer");
    expect(j).toMatchObject({ status: "ok", inputTokens: 7, outputTokens: 8 });
    expect(j.profileVersionId).toBeTruthy();
  });

  test("정리본은 긴급도를 바꾸지 않는다(urgencyNote가 달라도)", async () => {
    const d = await draft({ urgency: "low" });
    await submit(d, null);
    await summarizeTicket(db, d.id, deps({ ...SUMMARY, urgencyNote: "매우 급해 보여요 (urgent)" }));
    const after = await get(d.id);
    expect(after.urgency).toBe("low");
    expect(after.version).toBe(d.version + 1); // 제출로 올라간 것뿐, 정리본이 티켓을 바꾸지 않았다
    expect(((await summaryOf(d.id)).data as { urgencyNote: string }).urgencyNote).toBe("매우 급해 보여요 (urgent)");
  });

  test("인터뷰 기록이 없으면 original_only + '인터뷰 없이 제출됨'", async () => {
    const d = await draft();
    await submit(d, null);
    await summarizeTicket(db, d.id, deps({ ...SUMMARY, urgencyNote: null }));
    const s = await summaryOf(d.id);
    expect(s.generatedFrom).toBe("original_only");
    expect(s.markdown).toContain("인터뷰 없이 제출됨");
    expect(s.markdown).not.toContain("긴급도 참고");
  });

  test("제출 전 티켓은 정리하지 않는다", async () => {
    const d = await draft();
    const runner = vi.fn();
    await summarizeTicket(db, d.id, { runRoleAgent: runner as unknown as Run });
    expect(runner).not.toHaveBeenCalled();
    expect(await summaryOf(d.id)).toBeUndefined();
  });

  test("정리 실패는 판단 failed를 남기고 던진다(작업 재시도), 요청자가 고친 정리본은 다시 쓰지 않는다", async () => {
    const d = await draft();
    const t = await submit(d, { kind: "user", userId: w.dev.id });
    await expect(summarizeTicket(db, d.id, deps(new Error("boom")))).rejects.toThrow("boom");
    expect((await judgments(d.id)).at(-1)).toMatchObject({ role: "summarizer", status: "failed" });
    expect(await summaryOf(d.id)).toBeUndefined();

    await summarizeTicket(db, d.id, deps(SUMMARY));
    await editSummary(db, { ticketId: d.id, actor: await ctxOf(w.req.id), markdown: "내가 고친 정리본" });
    await summarizeTicket(db, d.id, deps({ ...SUMMARY, summary: "다시 만든 정리본" }));
    expect((await summaryOf(d.id)).markdown).toBe("내가 고친 정리본");
    expect(t.status).toBe("assigned");
  });

  // ---------- 정리본 수정 ----------

  async function withSummary(target: Parameters<typeof submitTicket>[1]["target"]) {
    const d = await draft();
    const t = await submit(d, target);
    await summarizeTicket(db, d.id, deps(SUMMARY));
    return t;
  }

  test("작성자는 수락 전(assigned)에 정리본을 고칠 수 있고, 이벤트와 담당자 알림이 남는다", async () => {
    const t = await withSummary({ kind: "user", userId: w.dev.id });
    await editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req.id), markdown: "고친 내용" });
    const s = await summaryOf(t.id);
    expect(s.markdown).toBe("고친 내용");
    expect(s.editedBy).toBe(w.req.id);
    expect(s.editedAt).toBeTruthy();
    const [ev] = await events(t.id, "summary_edited");
    expect(ev.actorId).toBe(w.req.id);
    const ns = await db.select().from(notifications).where(and(eq(notifications.ticketId, t.id), eq(notifications.kind, "summary_edited")));
    expect(ns.map((n) => n.userId)).toEqual([w.dev.id]);
  });

  test("대기열(queued)에서도 고칠 수 있다", async () => {
    const t = await withSummary({ kind: "group", groupId: w.group.id });
    await editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req.id), markdown: "그룹 큐에서 고침" });
    expect((await summaryOf(t.id)).markdown).toBe("그룹 큐에서 고침");
  });

  test("담당자가 수락한 뒤 요청자 정리본 수정 → 거부", async () => {
    const t = await withSummary({ kind: "user", userId: w.dev.id });
    await performAction(db, { ticketId: t.id, expectedVersion: (await get(t.id)).version, action: { type: "accept" }, actor: await ctxOf(w.dev.id) });
    await expect(editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req.id), markdown: "늦었어요" })).rejects.toBeInstanceOf(SummaryNotEditableError);
    expect((await summaryOf(t.id)).markdown).not.toBe("늦었어요");
    expect(await events(t.id, "summary_edited")).toHaveLength(0);
  });

  test("그룹 큐에서 가져간 뒤에도 거부", async () => {
    const t = await withSummary({ kind: "group", groupId: w.group.id });
    await db.insert((await import("@/lib/db/schema")).groupMembers).values({ groupId: w.group.id, userId: w.dev2.id });
    await performAction(db, { ticketId: t.id, expectedVersion: (await get(t.id)).version, action: { type: "claim" }, actor: await ctxOf(w.dev2.id) });
    await expect(editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req.id), markdown: "x" })).rejects.toBeInstanceOf(SummaryNotEditableError);
  });

  test("작성자가 아니면 거부(리드도), 빈 내용·정리본 없음도 거부", async () => {
    const t = await withSummary(null);
    await expect(editSummary(db, { ticketId: t.id, actor: await ctxOf(w.lead.id), markdown: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req2.id), markdown: "x" })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(editSummary(db, { ticketId: t.id, actor: await ctxOf(w.req.id), markdown: "   " })).rejects.toBeInstanceOf(SummaryNotEditableError);
    const noSummary = await draft();
    await submit(noSummary, null);
    await expect(editSummary(db, { ticketId: noSummary.id, actor: await ctxOf(w.req.id), markdown: "x" })).rejects.toBeInstanceOf(SummaryNotEditableError);
    await expect(editSummary(db, { ticketId: "00000000-0000-4000-8000-000000000000", actor: await ctxOf(w.req.id), markdown: "x" })).rejects.toBeInstanceOf(TicketNotFoundError);
  });

  // ---------- 바로 제출(조용한 검토) ----------

  test("바로 제출: ai_note 이벤트, 검토 턴 0건, 대상 변화 없음, 원문만으로 정리본", async () => {
    const origin = await submittedOther("로그인 화면 오류");
    const d = await draft({ title: "로그인 오류" });
    const t = await submit(d, { kind: "user", userId: w.dev.id });
    await db.delete(jobs);

    await runSilentReview(
      db,
      d.id,
      deps(
        { candidates: [{ ticketId: origin.id, reason: "증상이 같아요", differences: "" }] },
        NONE_RESOLVE,
        { target: { kind: "group", groupId: w.group.id }, reason: "화면 문제예요", evidence: [] },
        SUMMARY,
      ),
    );

    const notes = await events(d.id, "ai_note");
    expect(notes.map((n) => (n.to as { note: string }).note)).toEqual(["duplicate_candidates", "target_recommendation"]);
    expect(notes.every((n) => n.actorKind === "ai" && n.actorId === null)).toBe(true);
    expect(notes[0].to).toMatchObject({ note: "duplicate_candidates", candidates: [{ ticketId: origin.id, reason: "증상이 같아요" }] });
    expect(notes[1].to).toMatchObject({ note: "target_recommendation", target: { kind: "group", groupId: w.group.id }, reason: "화면 문제예요" });
    expect(await turns(d.id)).toHaveLength(0);
    const after = await get(d.id);
    expect(after.status).toBe("assigned");
    expect(after.targetUserId).toBe(w.dev.id);
    expect(after.targetGroupId).toBeNull();
    expect(after.version).toBe(t.version);
    expect(after.urgency).toBe("high");
    expect((await judgments(d.id)).map((j) => [j.role, j.stage, j.status])).toEqual([
      ["resolver", "dedup", "ok"],
      ["resolver", "resolve", "ok"],
      ["recommender", "recommend", "ok"],
      ["summarizer", null, "ok"],
    ]);
    const s = await summaryOf(d.id);
    expect(s.generatedFrom).toBe("original_only");
    expect(s.markdown).toContain("인터뷰 없이 제출됨");
    expect(await pendingJobs()).toHaveLength(0);
  });

  test("바로 제출: 해소 근거(유효한 것)도 ai_note로 남는다", async () => {
    const d = await draft();
    await submit(d, null);
    const { domainDocs } = await import("@/lib/db/schema");
    const [doc] = await db.insert(domainDocs).values({ projectId: w.project.id, title: "정책", body: "로그인은 5회 실패 시 잠겨요" }).returning();
    await runSilentReview(
      db,
      d.id,
      deps(NONE_DEDUP, { kind: "expected_behavior", message: "정상 동작이에요", evidence: [{ ref: `doc:${doc.id}`, note: "정책" }] }, NONE_REC, SUMMARY),
    );
    const notes = await events(d.id, "ai_note");
    expect(notes.map((n) => (n.to as { note: string }).note)).toEqual(["resolution"]);
    expect(notes[0].to).toMatchObject({ kind: "expected_behavior", message: "정상 동작이에요" });
    expect((await get(d.id)).status).toBe("queued");
  });

  test("바로 제출: 추천 대상이 프로젝트에 없으면 비고에 남기지 않는다", async () => {
    const d = await draft();
    await submit(d, null);
    const outsider = await signUp(w.auth, "silent-out@x.com", "외부");
    await runSilentReview(db, d.id, deps(NONE_DEDUP, NONE_RESOLVE, { target: { kind: "user", userId: outsider.id }, reason: "r", evidence: [] }, SUMMARY));
    expect(await events(d.id, "ai_note")).toHaveLength(0);
  });

  test("바로 제출: 한 단계가 실패해도 나머지와 정리본은 계속된다", async () => {
    const d = await draft();
    await submit(d, null);
    await runSilentReview(db, d.id, deps(new Error("dedup 실패"), NONE_RESOLVE, NONE_REC, SUMMARY));
    expect((await judgments(d.id)).map((j) => [j.stage, j.status])).toEqual([
      ["dedup", "failed"],
      ["resolve", "ok"],
      ["recommend", "ok"],
      [null, "ok"],
    ]);
    expect(await summaryOf(d.id)).toBeTruthy();
    expect(await turns(d.id)).toHaveLength(0);
  });

  test("바로 제출: 정리본 실패로 작업이 재시도돼도 비고는 한 번만 남는다", async () => {
    const origin = await submittedOther("재시도 원본");
    const d = await draft();
    await submit(d, null);
    const dedup = { candidates: [{ ticketId: origin.id, reason: "같아요", differences: "" }] };
    await expect(runSilentReview(db, d.id, deps(dedup, NONE_RESOLVE, NONE_REC, new Error("summary boom")))).rejects.toThrow("summary boom");
    expect(await events(d.id, "ai_note")).toHaveLength(1);
    await runSilentReview(db, d.id, deps(SUMMARY));
    expect(await events(d.id, "ai_note")).toHaveLength(1);
    expect(await summaryOf(d.id)).toBeTruthy();
  });

  test("제출 전 티켓은 바로 제출 검토를 하지 않는다", async () => {
    const d = await draft();
    const runner = vi.fn();
    await runSilentReview(db, d.id, { runRoleAgent: runner as unknown as Run });
    expect(runner).not.toHaveBeenCalled();
    expect(await events(d.id, "ai_note")).toHaveLength(0);
  });

  test("작업 핸들러가 등록돼 있다", () => {
    expect(handlers["ticket.summarize"]).toBeTypeOf("function");
    expect(handlers["ticket.silentReview"]).toBeTypeOf("function");
  });
});
