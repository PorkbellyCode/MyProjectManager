import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vitest";
import { asc, eq } from "drizzle-orm";

vi.mock("@/lib/env", () => ({ env: { MPM_FAKE_AI: "1" } }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));

import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { groups, ticketReviewTurns, ticketSummaries, tickets } from "@/lib/db/schema";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { DEFAULT_REQUIRED_FIELDS, interviewSystem } from "@/lib/agents/interview";
import { setFakeResponder } from "@/lib/ai/fake";
import { answeredValues, interviewFields, registerFakeRules, respondWithRules, toFakeInput } from "@/lib/ai/fake-rules";
import { runPending } from "@/lib/jobs/queue";
import { handlers } from "@/lib/jobs/handlers";
import { answerQuestions, requestReview, submitTicket } from "@/lib/review/pipeline";
import { renderAnswered } from "@/lib/review/records";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";

describe("가짜 AI 규칙 표(MPM_FAKE_AI=1, R3)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@f.com", "리드");
    const req = await signUp(auth, "req@f.com", "요청자");
    const { project, orgId } = await makeProject(db, auth, "fake-proj", lead.id, { isDemo: true });
    await addMember(auth, orgId, req.id, "requester");
    await ensureDefaultProfiles(db, project.id, lead.id);
    // 이름순: 백엔드 < 프론트엔드 (만든 순서와 반대로 넣어 정렬을 확인한다)
    const [front] = await db.insert(groups).values({ projectId: project.id, name: "프론트엔드" }).returning();
    const [back] = await db.insert(groups).values({ projectId: project.id, name: "백엔드" }).returning();
    const origin = await createDraft(db, { projectId: project.id, authorId: lead.id, title: "요약 화면 오류", body: "요약이 두 번", category: "defect", urgency: "normal" });
    await performAction(db, {
      ticketId: origin.id,
      expectedVersion: origin.version,
      action: { type: "submit", target: null },
      actor: await getActorCtx(db, project.id, lead.id),
    });
    // 초안은 후보가 되지 않는다.
    await createDraft(db, { projectId: project.id, authorId: lead.id, title: "요약 초안", body: "", category: "defect", urgency: "normal" });
    return { lead, req, project, front, back, origin };
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());
  afterEach(() => setFakeResponder(null));

  const useRules = () => setFakeResponder((ctx) => respondWithRules(ctx, db));
  const drain = async () => {
    while ((await runPending(db, handlers)) > 0) {
      /* 다음 단계 작업이 생기면 계속 */
    }
  };
  const get = async (id: string) => (await db.select().from(tickets).where(eq(tickets.id, id)))[0];
  const openTurn = async (id: string) => {
    const rows = await db.select().from(ticketReviewTurns).where(eq(ticketReviewTurns.ticketId, id)).orderBy(asc(ticketReviewTurns.createdAt));
    return rows.at(-1)!;
  };
  const newTicket = async (title: string, body: string) => {
    const t = await createDraft(db, { projectId: w.project.id, authorId: w.req.id, title, body, category: "defect", urgency: "normal" });
    const actor = await getActorCtx(db, w.project.id, w.req.id);
    return { t, actor };
  };

  test("본문에 '중복'이면 제목 낱말이 겹치는 제출된 티켓을 후보로 낸다(초안·자기 자신 제외)", async () => {
    useRules();
    const { t, actor } = await newTicket("요약 화면 깨짐", "중복 같아요");
    await requestReview(db, { ticketId: t.id, expectedVersion: t.version, actor });
    await drain();
    expect((await get(t.id)).status).toBe("awaiting_requester");
    const turn = await openTurn(t.id);
    expect(turn.kind).toBe("duplicate_candidates");
    const p = turn.payload as { candidates: { ticketId: string; reason: string; differences: string }[] };
    expect(p.candidates.map((c) => c.ticketId)).toEqual([w.origin.id]);
    expect(p.candidates[0].reason).toContain("#1");
    expect(p.candidates[0].differences).not.toBe("");
  });

  test("중복·해소 없음 → 1라운드 3문항(single·scale·attachment) → 2라운드 글 1문항 → 이름순 첫 그룹 추천", async () => {
    useRules();
    const { t, actor } = await newTicket("차트가 비어요", "리포트 차트가 안 그려져요");
    await requestReview(db, { ticketId: t.id, expectedVersion: t.version, actor });
    await drain();

    let turn = await openTurn(t.id);
    expect(turn.kind).toBe("questions");
    const r1 = turn.payload as { round: number; questions: { id: string; type: string; prompt: string; fillsKey: string; justification?: string }[] };
    expect(r1.round).toBe(1);
    expect(r1.questions.map((q) => [q.type, q.prompt])).toEqual([
      ["single", "어디서 겪으셨나요?"],
      ["scale", "매번 그런가요?"],
      ["attachment", "문제가 보이는 화면을 캡처해 주실 수 있나요?"],
    ]);
    expect(r1.questions.map((q) => q.fillsKey)).toEqual(["environment", "frequency", "screenshot"]);

    let cur = await get(t.id);
    await answerQuestions(db, { ticketId: t.id, expectedVersion: cur.version, actor, answers: [{ questionId: r1.questions[0].id, value: "PC 웹" }, { questionId: r1.questions[1].id, value: "unknown" }] });
    await drain();
    turn = await openTurn(t.id);
    const r2 = turn.payload as { round: number; questions: { id: string; type: string; prompt: string; fillsKey: string }[] };
    expect(r2.round).toBe(2);
    expect(r2.questions).toHaveLength(1);
    expect(r2.questions[0]).toMatchObject({ type: "text", fillsKey: "steps", prompt: "어떤 순서로 하면 문제가 생기나요?" });

    cur = await get(t.id);
    await answerQuestions(db, { ticketId: t.id, expectedVersion: cur.version, actor, answers: [{ questionId: r2.questions[0].id, value: "메뉴 → 차트" }] });
    await drain();
    turn = await openTurn(t.id);
    expect(turn.kind).toBe("ready");
    expect(turn.payload).toMatchObject({ target: { kind: "group", groupId: w.back.id }, reason: "'백엔드' 그룹의 담당 범위와 가장 가까워 보여요." });

    cur = await get(t.id);
    await submitTicket(db, { ticketId: t.id, expectedVersion: cur.version, actor, target: { kind: "group", groupId: w.front.id } });
    await drain();
    const [s] = await db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, t.id));
    expect(s.generatedFrom).toBe("interview");
    expect(s.markdown).toContain("PC 웹");
    expect(s.markdown).toContain("알 수 없음"); // 모르겠어요 → 알 수 없음
    expect(s.markdown).not.toContain("인터뷰 없이 제출됨");
  });

  test("바로 제출하면 조용한 검토 뒤 정리본에 '인터뷰 없이 제출됨'", async () => {
    useRules();
    const { t, actor } = await newTicket("문구 바꿔 주세요", "알림 설명이 길어요");
    await submitTicket(db, { ticketId: t.id, expectedVersion: t.version, actor, target: null });
    await drain();
    const [s] = await db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, t.id));
    expect(s.generatedFrom).toBe("original_only");
    expect(s.markdown).toContain("> 인터뷰 없이 제출됨");
    expect((await get(t.id)).status).toBe("queued");
  });

  test("해소는 일반 규칙에서 제안하지 않고, 추가 규칙(Task 17)이 앞에 끼어들 수 있다", async () => {
    const ctx = (system: string, body: string) => ({
      modelId: "anthropic:x",
      prompt: [
        { role: "system", content: system },
        { role: "user", content: [{ type: "text", text: `<ticket>\n검토 중인 티켓 id: ${w.origin.id}\n제목: t\n분류: defect\n긴급도: normal\n\n본문:\n${body}\n</ticket>` }] },
      ],
    });
    expect(await respondWithRules(ctx("# 이번 작업: 해소 확인\n", "이어가기 안 돼요"), db)).toEqual({ kind: "none", message: "", evidence: [] });
    registerFakeRules([{ name: "test", task: "resolve", when: (i) => i.body.includes("이어가기"), respond: () => ({ kind: "already_resolved", message: "고쳐졌어요", evidence: [] }) }]);
    expect(await respondWithRules(ctx("# 이번 작업: 해소 확인\n", "이어가기 안 돼요"), db)).toMatchObject({ kind: "already_resolved" });
    expect(toFakeInput(ctx("# 이번 작업: 해소 확인\n", "본문 한 줄")).body).toBe("본문 한 줄");
  });

  test("프롬프트 읽기: 필요 정보 목록과 답변 기록", () => {
    const fields = DEFAULT_REQUIRED_FIELDS.defect;
    const system = interviewSystem("지시", { round: 1, fields, filled: new Set(["steps"]) });
    const parsed = interviewFields(system);
    expect(parsed.map((f) => f.key)).toEqual(fields.map((f) => f.key));
    expect(parsed.find((f) => f.key === "steps")?.filled).toBe(true);
    expect(parsed.find((f) => f.key === "environment")?.label).toBe("환경(기기·브라우저·앱 버전)");
    const user = renderAnswered([
      { round: 1, questionId: "r1-q1", fillsKey: "environment", prompt: "어디서?", type: "single", value: "PC 웹" },
      { round: 1, questionId: "r1-q3", fillsKey: "screenshot", prompt: "캡처?", type: "attachment", value: "", attachmentUrls: ["/api/files/a.png"] },
      { round: 1, questionId: "r1-q2", fillsKey: "frequency", prompt: "매번?", type: "scale", value: "unknown" },
    ]);
    const values = answeredValues(user);
    expect(values.get("environment")).toBe("PC 웹");
    expect(values.get("screenshot")).toBe("(첨부만)");
    expect(values.get("frequency")).toBe("알 수 없음");
  });
});
