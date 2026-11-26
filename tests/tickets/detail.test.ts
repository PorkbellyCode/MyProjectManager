import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));

import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { groups, ticketEvents } from "@/lib/db/schema";
import { getNewTicketContext, getTicketDetail, listTargetOptions } from "@/lib/tickets/detail";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";

describe("상세 읽기 모델(접근·회수·대상 목록)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@d.com", "리드");
    const dev = await signUp(auth, "dev@d.com", "개발");
    const req = await signUp(auth, "req@d.com", "요청");
    const outsider = await signUp(auth, "out@d.com", "외부");
    const { project, orgId } = await makeProject(db, auth, "detail-proj", lead.id, { isDemo: true });
    const other = await makeProject(db, auth, "detail-other", outsider.id);
    await addMember(auth, orgId, dev.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await db.insert(groups).values([{ projectId: project.id, name: "프론트" }, { projectId: project.id, name: "백엔드" }]);
    const t = await createDraft(db, { projectId: project.id, authorId: req.id, title: "제목", body: "본문", category: "defect", urgency: "normal" });
    return { lead, dev, req, outsider, project, other: other.project, t };
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());

  test("비멤버·다른 프로젝트 경로·잘못된 id는 null(404)", async () => {
    expect(await getTicketDetail(db, { projectId: w.project.id, ticketId: w.t.id, userId: w.outsider.id })).toBeNull();
    expect(await getTicketDetail(db, { projectId: w.other.id, ticketId: w.t.id, userId: w.outsider.id })).toBeNull();
    expect(await getTicketDetail(db, { projectId: w.project.id, ticketId: "not-a-uuid", userId: w.req.id })).toBeNull();
    expect(await getNewTicketContext(db, w.project.id, w.outsider.id)).toBeNull();
  });

  test("대상 목록은 요청자를 빼고, 그룹은 이름순", async () => {
    const o = await listTargetOptions(db, w.project.id);
    expect(o.people.map((p) => p.name).sort()).toEqual(["개발", "리드"]);
    expect(o.groups.map((g) => g.name)).toEqual(["백엔드", "프론트"]);
    const ctx = await getNewTicketContext(db, w.project.id, w.req.id);
    expect(ctx?.project.aiAvailable).toBe(true);
  });

  test("요청자는 제출 뒤에 회수할 수 있고, 제출 전과 다른 사람은 못 한다", async () => {
    const draft = await getTicketDetail(db, { projectId: w.project.id, ticketId: w.t.id, userId: w.req.id });
    expect(draft?.viewer.isAuthor).toBe(true);
    expect(draft?.canWithdraw).toBe(false);
    expect(draft?.summaryPending).toBe(false);
    await performAction(db, { ticketId: w.t.id, expectedVersion: w.t.version, action: { type: "submit", target: null }, actor: await getActorCtx(db, w.project.id, w.req.id) });
    const mine = await getTicketDetail(db, { projectId: w.project.id, ticketId: w.t.id, userId: w.req.id });
    expect(mine?.ticket.status).toBe("queued");
    expect(mine?.canWithdraw).toBe(true);
    expect(mine?.summaryPending).toBe(true); // AI 티켓, 정리본 아직 없음
    const theirs = await getTicketDetail(db, { projectId: w.project.id, ticketId: w.t.id, userId: w.dev.id });
    expect(theirs?.canWithdraw).toBe(false);
    expect(theirs?.timeline.length).toBeGreaterThan(0);
  });

  test("처리 패널: 개발자는 '안 하기로 함' 대신 제안, lead는 직접. 중복 후보·AI 추천을 미리 채운다", async () => {
    const actor = (id: string) => getActorCtx(db, w.project.id, id);
    const [g] = await db.select().from(groups).limit(1);
    const origin = await createDraft(db, { projectId: w.project.id, authorId: w.req.id, title: "원본", body: "", category: "defect", urgency: "normal" });
    await performAction(db, { ticketId: origin.id, expectedVersion: origin.version, action: { type: "submit", target: null }, actor: await actor(w.req.id) });
    const d = await createDraft(db, { projectId: w.project.id, authorId: w.req.id, title: "같은 증상", body: "", category: "defect", urgency: "normal" });
    const q = await performAction(db, { ticketId: d.id, expectedVersion: d.version, action: { type: "submit", target: null }, actor: await actor(w.req.id) });
    await db.insert(ticketEvents).values([
      { ticketId: d.id, actorKind: "ai", type: "ai_note", to: { note: "duplicate_candidates", candidates: [{ ticketId: origin.id, number: origin.number, title: "원본", reason: "같아요" }] } },
      { ticketId: d.id, actorKind: "ai", type: "ai_note", to: { note: "target_recommendation", target: { kind: "group", groupId: g.id }, reason: "범위" } },
    ]);
    const asLead = await getTicketDetail(db, { projectId: w.project.id, ticketId: d.id, userId: w.lead.id });
    expect(asLead?.actions).toEqual(expect.arrayContaining(["claim", "assignTarget", "transfer", "close"]));
    expect(asLead?.closeReasons).toEqual(expect.arrayContaining(["wont_do", "duplicate", "other"]));
    expect(asLead?.canProposeWontDo).toBe(false);
    expect(asLead?.canSetUrgency).toBe(true);
    expect(asLead?.duplicateCandidate).toMatchObject({ id: origin.id, number: origin.number });
    expect(asLead?.aiRecommendation).toMatchObject({ target: { kind: "group", groupId: g.id }, reason: "범위" });

    await performAction(db, { ticketId: d.id, expectedVersion: q.version, action: { type: "assignTarget", target: { kind: "user", userId: w.dev.id } }, actor: await actor(w.lead.id) });
    const asDev = await getTicketDetail(db, { projectId: w.project.id, ticketId: d.id, userId: w.dev.id });
    expect(asDev?.actions).toContain("accept");
    expect(asDev?.closeReasons).not.toContain("wont_do");
    expect(asDev?.closeReasons).toContain("duplicate");
    expect(asDev?.canProposeWontDo).toBe(true);
    expect(asDev?.canSetUrgency).toBe(false);
  });
});
