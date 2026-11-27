import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/access";
import type { Db } from "@/lib/db";
import { notifications, ticketEvents, tickets } from "@/lib/db/schema";
import type { Urgency } from "@/lib/db/schema/tickets";
import { deleteGroup, setGroupMembers, upsertGroup } from "@/lib/groups/service";
import { listTickets, searchTickets } from "@/lib/tickets/list";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";
import type { Target, TicketAction } from "@/lib/tickets/state-machine";
import { listNotifications, markNotificationsRead, countUnread } from "@/lib/notifications/queries";
import { eq } from "drizzle-orm";

type U = { id: string };

describe("ticket list views (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@list.test", "리드");
    const fe = await signUp(auth, "fe@list.test", "프론트");
    const be = await signUp(auth, "be@list.test", "백엔드개발");
    const req = await signUp(auth, "req@list.test", "요청자");
    const req2 = await signUp(auth, "req2@list.test", "요청자2");
    const outsider = await signUp(auth, "out@list.test", "외부인");
    const { project, orgId } = await makeProject(db, auth, "list-proj", lead.id);
    await makeProject(db, auth, "list-other", outsider.id);
    await addMember(auth, orgId, fe.id, "developer");
    await addMember(auth, orgId, be.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await addMember(auth, orgId, req2.id, "requester");
    const gFe = await upsertGroup(db, { projectId: project.id, name: "프론트", scopeDescription: "UI", repoTags: [] });
    const gBe = await upsertGroup(db, { projectId: project.id, name: "백엔드", scopeDescription: "API", repoTags: [] });
    await setGroupMembers(db, gFe.id, [fe.id]);
    await setGroupMembers(db, gBe.id, [be.id]);
    return { project, lead, fe, be, req, req2, outsider, gFe, gBe };
  }

  const ctx = (u: U) => getActorCtx(db, w.project.id, u.id);
  const act = async (t: { id: string; version: number }, action: TicketAction, u: U) =>
    performAction(db, { ticketId: t.id, expectedVersion: t.version, action, actor: await ctx(u) });
  const draft = (author: U, title: string, urgency: Urgency = "normal") =>
    createDraft(db, { projectId: w.project.id, authorId: author.id, title, body: "", category: "defect", urgency });
  const submitted = async (author: U, title: string, target: Target, urgency: Urgency = "normal") => act(await draft(author, title, urgency), { type: "submit", target }, author);
  const titles = async (u: U, view: Parameters<typeof listTickets>[1]["view"], extra: Partial<Parameters<typeof listTickets>[1]> = {}) =>
    (await listTickets(db, { projectId: w.project.id, userId: u.id, view, ...extra })).rows.map((r) => r.title).sort();

  let t: Record<string, { id: string; version: number; number: number }>;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
    t = {};
    t.feQueue = await submitted(w.req, "프론트 큐", { kind: "group", groupId: w.gFe.id }, "high");
    t.beQueue = await submitted(w.req, "백엔드 큐", { kind: "group", groupId: w.gBe.id }, "urgent");
    t.leadQueue = await submitted(w.req, "리드 큐", null, "low");
    t.feAssigned = await submitted(w.req2, "프론트에게 배정", { kind: "user", userId: w.fe.id });
    const claimed = await submitted(w.req, "프론트가 진행", { kind: "group", groupId: w.gFe.id });
    t.feWorking = await act(claimed, { type: "claim" }, w.fe);
    const done = await act(await act(await submitted(w.req, "확인 대기 건", { kind: "group", groupId: w.gFe.id }), { type: "claim" }, w.fe), { type: "resolve" }, w.fe);
    t.resolved = done;
    const closedBase = await act(await submitted(w.req2, "끝난 건", { kind: "group", groupId: w.gFe.id }), { type: "claim" }, w.fe);
    t.closed = await act(closedBase, { type: "close", reason: "wont_do" }, w.lead);
    t.reqDraft = await draft(w.req, "요청자 초안");
    // R24: 제출되지 않은 채 철회된 티켓과 검토 중인 티켓(req2). req2 본인 말고는 어디에도 보이지 않는다.
    const wd = await draft(w.req2, "철회된 초안 건");
    await db.update(tickets).set({ status: "withdrawn_ai_resolved", withdrawKind: "already_resolved" }).where(eq(tickets.id, wd.id));
    const rv = await draft(w.req2, "검토 중인 초안 건");
    await db.update(tickets).set({ status: "ai_reviewing" }).where(eq(tickets.id, rv.id));
    t.req2Draft = await draft(w.req2, "다른 사람 초안");
  });
  afterAll(async () => close());

  test("내 티켓: 대상 사람이 나 또는 담당자가 나, 끝난 건은 상태 필터가 있을 때만", async () => {
    expect(await titles(w.fe, "mine")).toEqual(["프론트가 진행", "프론트에게 배정", "확인 대기 건"].sort());
    expect(await titles(w.fe, "mine", { status: ["closed"] })).toEqual(["끝난 건"]);
    expect(await titles(w.be, "mine")).toEqual([]);
  });

  test("내 그룹 큐: 내 그룹으로 들어온 큐 대기만", async () => {
    expect(await titles(w.fe, "group")).toEqual(["프론트 큐"]);
    expect(await titles(w.be, "group")).toEqual(["백엔드 큐"]);
    expect(await titles(w.lead, "group")).toEqual([]); // lead는 그룹에 속하지 않음
  });

  test("리드 큐: lead만, 개발자가 고르면 기본 뷰(내 티켓)로 바뀐다", async () => {
    expect(await titles(w.lead, "lead")).toEqual(["리드 큐"]);
    const dev = await listTickets(db, { projectId: w.project.id, userId: w.fe.id, view: "lead" });
    expect(dev.view).toBe("mine");
    expect(dev.views).not.toContain("lead");
  });

  test("확인 대기: 요청자는 자기 것, lead는 전부", async () => {
    expect(await titles(w.req, "confirm")).toEqual(["확인 대기 건"]);
    expect(await titles(w.req2, "confirm")).toEqual([]);
    expect(await titles(w.lead, "confirm")).toEqual(["확인 대기 건"]);
  });

  test("전체: 초안·검토 중인 티켓은 누구의 것이든 빠진다. 내 요청: 내 초안은 보인다", async () => {
    const all = await titles(w.fe, "all");
    expect(all).toHaveLength(7);
    expect(all).not.toContain("요청자 초안");
    expect(all).not.toContain("다른 사람 초안");
    const mine = await titles(w.req, "requested");
    expect(mine).toContain("요청자 초안");
    expect(mine).not.toContain("다른 사람 초안");
  });

  test("R24: 다른 사람의 철회·검토 중 티켓은 모든 뷰·개수·검색에서 빠지고, 작성자의 내 요청에는 보인다", async () => {
    for (const u of [w.lead, w.fe, w.req]) {
      const all = await listTickets(db, { projectId: w.project.id, userId: u.id, view: "all" });
      expect(all.rows.map((r) => r.title)).not.toContain("철회된 초안 건");
      expect(all.rows.map((r) => r.title)).not.toContain("검토 중인 초안 건");
      expect(all.counts.all).toBe(7);
      for (const v of all.views) expect(await titles(u, v, { status: [] })).not.toContain("철회된 초안 건");
      expect((await searchTickets(db, { projectId: w.project.id, userId: u.id, query: "초안 건" })).map((h) => h.title)).toEqual([]);
    }
    expect(await titles(w.lead, "all", { status: ["closed"] })).toEqual(["끝난 건"]);
    const mine = await titles(w.req2, "requested");
    expect(mine).toEqual(expect.arrayContaining(["철회된 초안 건", "검토 중인 초안 건", "다른 사람 초안"]));
    expect((await searchTickets(db, { projectId: w.project.id, userId: w.req2.id, query: "초안 건" })).map((h) => h.title).sort()).toEqual(["검토 중인 초안 건", "철회된 초안 건"].sort());
  });

  test("긴급도·상태 필터, 긴급도 높은 순 정렬, 뷰별 개수", async () => {
    expect(await titles(w.lead, "all", { urgency: ["urgent", "high"] })).toEqual(["백엔드 큐", "프론트 큐"].sort());
    expect(await titles(w.lead, "all", { status: ["queued"], urgency: ["low"] })).toEqual(["리드 큐"]);
    const r = await listTickets(db, { projectId: w.project.id, userId: w.lead.id, view: "all" });
    expect(r.rows[0].title).toBe("백엔드 큐");
    expect(r.rows.at(-1)?.urgency).toBe("low");
    expect(r.total).toBe(7);
    expect(r.counts).toMatchObject({ all: 7, lead: 1, confirm: 1 });
  });

  test("탭 개수는 필터를 걸어도 뷰 전체 개수 그대로다(total만 필터 결과)", async () => {
    const f = await listTickets(db, { projectId: w.project.id, userId: w.lead.id, view: "all", urgency: ["low"], status: ["queued"] });
    expect(f.total).toBe(1);
    expect(f.counts).toMatchObject({ all: 7, lead: 1, confirm: 1 });
    const none = await listTickets(db, { projectId: w.project.id, userId: w.lead.id, view: "all", status: ["on_hold"] });
    expect(none.total).toBe(0);
    expect(none.counts.all).toBe(7);
  });

  test("기본 뷰: 요청자는 내 요청, 개발자는 내 티켓", async () => {
    expect((await listTickets(db, { projectId: w.project.id, userId: w.req.id })).view).toBe("requested");
    expect((await listTickets(db, { projectId: w.project.id, userId: w.fe.id })).view).toBe("mine");
  });

  test("멤버가 아니면 ForbiddenError(잘못된 id 포함)", async () => {
    await expect(listTickets(db, { projectId: w.project.id, userId: w.outsider.id })).rejects.toBeInstanceOf(ForbiddenError);
    await expect(listTickets(db, { projectId: "nope", userId: w.lead.id })).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("AI 비고: 조용한 검토의 추천 대상은 이름으로, 대상이 없어지면 보이지 않는다", async () => {
    const g = await upsertGroup(db, { projectId: w.project.id, name: "임시", scopeDescription: "", repoTags: [] });
    await db.insert(ticketEvents).values({
      ticketId: t.leadQueue.id,
      actorKind: "ai",
      type: "ai_note",
      to: { note: "target_recommendation", target: { kind: "group", groupId: g.id }, reason: "범위가 맞아요" },
    });
    let row = (await listTickets(db, { projectId: w.project.id, userId: w.lead.id, view: "lead" })).rows[0];
    expect(row.aiNote).toEqual({ kind: "recommendation", targetLabel: "임시", reason: "범위가 맞아요" });
    expect(row.target).toEqual({ kind: "lead", label: "리드 큐" });
    await deleteGroup(db, g.id, w.lead.id);
    row = (await listTickets(db, { projectId: w.project.id, userId: w.lead.id, view: "lead" })).rows[0];
    expect(row.aiNote).toBeNull();
  });

  test("검색: #번호, 제목 부분 일치, 다른 사람의 초안은 안 보임, 비멤버 거부", async () => {
    const byNum = await searchTickets(db, { projectId: w.project.id, userId: w.fe.id, query: `#${t.feQueue.number}` });
    expect(byNum.map((h) => h.title)).toEqual(["프론트 큐"]);
    expect((await searchTickets(db, { projectId: w.project.id, userId: w.fe.id, query: "큐" })).map((h) => h.title).sort()).toEqual(["리드 큐", "백엔드 큐", "프론트 큐"].sort());
    expect(await searchTickets(db, { projectId: w.project.id, userId: w.fe.id, query: "초안" })).toEqual([]);
    expect((await searchTickets(db, { projectId: w.project.id, userId: w.req.id, query: "초안" })).map((h) => h.title)).toEqual(["요청자 초안"]);
    expect(await searchTickets(db, { projectId: w.project.id, userId: w.fe.id, query: "100%_" })).toEqual([]);
    await expect(searchTickets(db, { projectId: w.project.id, userId: w.outsider.id, query: "큐" })).rejects.toBeInstanceOf(ForbiddenError);
  });

  test("알림: 내 것만 최근순으로, 읽음 처리는 내 알림만 바꾼다", async () => {
    const feList = await listNotifications(db, w.fe.id);
    expect(feList.length).toBeGreaterThan(0);
    expect(feList.every((n) => n.ticket.projectId === w.project.id)).toBe(true);
    const sorted = [...feList].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    expect(feList.map((n) => n.id)).toEqual(sorted.map((n) => n.id));

    const [beFirst] = await db.select().from(notifications).where(eq(notifications.userId, w.be.id));
    // 다른 사람의 알림 id를 넣어도 바뀌지 않는다.
    expect(await markNotificationsRead(db, w.fe.id, [beFirst.id])).toBe(0);
    expect(await countUnread(db, w.be.id)).toBeGreaterThan(0);
    const before = await countUnread(db, w.fe.id);
    expect(await markNotificationsRead(db, w.fe.id, [feList[0].id])).toBe(1);
    expect(await countUnread(db, w.fe.id)).toBe(before - 1);
    await markNotificationsRead(db, w.fe.id);
    expect(await countUnread(db, w.fe.id)).toBe(0);
    expect(await markNotificationsRead(db, w.fe.id, [])).toBe(0);
  });
});
