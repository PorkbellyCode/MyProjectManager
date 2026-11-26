import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, asc, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { createPgTestDb, pgAvailable } from "../helpers/pg";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import { ForbiddenError } from "@/lib/access";
import type { Db } from "@/lib/db";
import {
  groupMembers,
  groups,
  notifications,
  ticketEvents,
  ticketSubscriptions,
  tickets,
} from "@/lib/db/schema";
import {
  ConflictError,
  createDraft,
  getActorCtx,
  InvalidDuplicateError,
  performAction,
  proposeWontDo,
  setUrgency,
  subscribe,
} from "@/lib/tickets/service";
import { InvalidTargetError } from "@/lib/tickets/targets";
import { InvalidLinkedRefError } from "@/lib/tickets/linked-refs";
import { TransitionError, type ActorCtx, type TicketAction } from "@/lib/tickets/state-machine";
import { deleteGroup, setGroupMembers, upsertGroup } from "@/lib/groups/service";

type U = { id: string };

async function buildWorld(db: Db) {
  const auth = createAuth(db);
  const lead = await signUp(auth, "lead@example.com", "리드");
  const lead2 = await signUp(auth, "lead2@example.com", "리드2");
  const dev1 = await signUp(auth, "dev1@example.com", "개발1");
  const dev2 = await signUp(auth, "dev2@example.com", "개발2");
  const dev3 = await signUp(auth, "dev3@example.com", "개발3");
  const req = await signUp(auth, "req@example.com", "요청자");
  const outsider = await signUp(auth, "out@example.com", "외부인");
  const { project, orgId } = await makeProject(db, auth, "svc-proj", lead.id, { isDemo: true });
  const other = await makeProject(db, auth, "svc-other", outsider.id);
  await addMember(auth, orgId, lead2.id, "lead");
  for (const u of [dev1, dev2, dev3]) await addMember(auth, orgId, u.id, "developer");
  await addMember(auth, orgId, req.id, "requester");
  const g1 = await upsertGroup(db, { projectId: project.id, name: "백엔드", scopeDescription: "API", repoTags: ["api"] });
  const g2 = await upsertGroup(db, { projectId: project.id, name: "프론트", scopeDescription: "UI", repoTags: [] });
  await setGroupMembers(db, g1.id, [dev1.id, dev2.id]);
  await setGroupMembers(db, g2.id, [dev3.id]);
  return { auth, project, orgId, otherProject: other.project, lead, lead2, dev1, dev2, dev3, req, outsider, g1, g2 };
}

const draftInput = (projectId: string, authorId: string, extra = {}) => ({
  projectId,
  authorId,
  title: "로그인이 안 돼요",
  body: "재현: …",
  category: "defect" as const,
  urgency: "normal" as const,
  ...extra,
});

describe("ticket service (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof buildWorld>>;

  const ctx = (u: U) => getActorCtx(db, w.project.id, u.id);
  const events = (ticketId: string) =>
    db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, ticketId)).orderBy(asc(ticketEvents.createdAt));
  const notifiedUsers = async (ticketId: string, kind?: string) =>
    (
      await db.select().from(notifications).where(eq(notifications.ticketId, ticketId))
    )
      .filter((n) => !kind || n.kind === kind)
      .map((n) => n.userId)
      .sort();
  const act = async (t: { id: string; version: number }, action: TicketAction, u: U) =>
    performAction(db, { ticketId: t.id, expectedVersion: t.version, action, actor: await ctx(u) });
  const submitted = async (author: U, target: Parameters<typeof createDraft>[1]["target"]) => {
    const d = await createDraft(db, draftInput(w.project.id, author.id));
    return act(d, { type: "submit", target: target ?? null }, author);
  };

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await buildWorld(db);
  });
  afterAll(async () => close());

  describe("getActorCtx", () => {
    test("역할과 소속 그룹 id", async () => {
      expect(await ctx(w.dev1)).toEqual({ userId: w.dev1.id, role: "developer", groupIds: [w.g1.id] });
      expect(await ctx(w.req)).toEqual({ userId: w.req.id, role: "requester", groupIds: [] });
      expect((await ctx(w.lead)).role).toBe("lead");
    });
    test("프로젝트 멤버가 아니면 거부", async () => {
      await expect(getActorCtx(db, w.project.id, w.outsider.id)).rejects.toThrow();
    });
  });

  describe("createDraft", () => {
    test("number는 프로젝트별 max+1, aiAvailable은 isDemo, 작성자 자동 구독, 이벤트 1행", async () => {
      const a = await createDraft(db, draftInput(w.project.id, w.req.id));
      const b = await createDraft(db, draftInput(w.project.id, w.req.id));
      expect(b.number).toBe(a.number + 1);
      expect(a).toMatchObject({ status: "draft", version: 0, aiAvailable: true, authorId: w.req.id });
      const subs = await db.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, a.id));
      expect(subs.map((s) => s.userId)).toEqual([w.req.id]);
      expect((await events(a.id)).map((e) => e.type)).toEqual(["created"]);
      // 다른 프로젝트는 1부터, 데모가 아니면 aiAvailable=false
      const o = await createDraft(db, draftInput(w.otherProject.id, w.outsider.id));
      expect(o).toMatchObject({ number: 1, aiAvailable: false });
    });
    test("프로젝트 멤버가 아니면 거부, 잘못된 대상은 InvalidTargetError", async () => {
      await expect(createDraft(db, draftInput(w.project.id, w.outsider.id))).rejects.toThrow();
      await expect(
        createDraft(db, draftInput(w.project.id, w.req.id, { target: { kind: "user", userId: w.outsider.id } })),
      ).rejects.toBeInstanceOf(InvalidTargetError);
    });
    test("동시에 만들어도 번호가 겹치지 않는다", async () => {
      const ts = await Promise.all(Array.from({ length: 4 }, () => createDraft(db, draftInput(w.project.id, w.req.id))));
      expect(new Set(ts.map((t) => t.number)).size).toBe(4);
    });
  });

  describe("performAction", () => {
    test("동작마다 이벤트 1행, version+1, updatedAt 갱신", async () => {
      const d = await createDraft(db, draftInput(w.project.id, w.req.id));
      const t1 = await act(d, { type: "submit", target: { kind: "group", groupId: w.g1.id } }, w.req);
      expect(t1).toMatchObject({ status: "queued", targetGroupId: w.g1.id, version: 1 });
      expect(t1.updatedAt.getTime()).toBeGreaterThanOrEqual(d.updatedAt.getTime());
      const t2 = await act(t1, { type: "claim" }, w.dev1);
      expect(t2).toMatchObject({ status: "in_progress", assigneeId: w.dev1.id, version: 2 });
      const t3 = await act(t2, { type: "hold", reason: "답변 대기" }, w.dev1);
      expect(t3.version).toBe(3);
      const evs = await events(d.id);
      expect(evs.map((e) => e.type)).toEqual(["created", "submit", "claim", "hold"]);
      expect(evs[2]).toMatchObject({ actorId: w.dev1.id, actorKind: "user" });
      expect(evs[2].from).toMatchObject({ status: "queued" });
      expect(evs[2].to).toMatchObject({ status: "in_progress", assigneeId: w.dev1.id });
      expect(evs[3].reason).toBe("답변 대기");
    });

    test("expectedVersion이 낡으면 ConflictError(정확한 문구), 아무것도 쓰지 않는다", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      await act(t, { type: "claim" }, w.dev1);
      const before = (await events(t.id)).length;
      const err = await act(t, { type: "claim" }, w.dev2).catch((e) => e);
      expect(err).toBeInstanceOf(ConflictError);
      expect(err.message).toBe("이미 다른 사람이 처리했어요. 새로고침해 주세요.");
      expect((await events(t.id)).length).toBe(before);
    });

    test("동시에 그룹 큐 claim하면 한 명만 성공", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const rs = await Promise.allSettled(
        [w.dev1, w.dev2].map((a) => act(t, { type: "claim" }, a)),
      );
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      expect((rs.find((r) => r.status === "rejected") as PromiseRejectedResult).reason).toBeInstanceOf(ConflictError);
      const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(row.version).toBe(t.version + 1);
      expect((await events(t.id)).filter((e) => e.type === "claim")).toHaveLength(1);
    });

    test("상태 기계 거부는 TransitionError로 그대로 올라오고 롤백된다", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      await expect(act(t, { type: "claim" }, w.dev3)).rejects.toBeInstanceOf(TransitionError); // 다른 그룹
      await expect(act(t, { type: "claim" }, w.req)).rejects.toBeInstanceOf(TransitionError);
      const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(row.version).toBe(t.version);
    });

    test("없는 티켓은 에러", async () => {
      await expect(
        performAction(db, {
          ticketId: "00000000-0000-0000-0000-000000000000",
          expectedVersion: 0,
          action: { type: "claim" },
          actor: await ctx(w.dev1),
        }),
      ).rejects.toThrow();
    });

    test("submit/assignTarget/transfer의 대상은 validateTarget을 통과해야 한다", async () => {
      const d = await createDraft(db, draftInput(w.project.id, w.req.id));
      await expect(act(d, { type: "submit", target: { kind: "group", groupId: w.otherProject.id } }, w.req)).rejects.toBeInstanceOf(InvalidTargetError);
      await expect(act(d, { type: "submit", target: { kind: "user", userId: w.outsider.id } }, w.req)).rejects.toBeInstanceOf(InvalidTargetError);
      const q = await act(d, { type: "submit", target: null }, w.req);
      await expect(act(q, { type: "assignTarget", target: { kind: "user", userId: w.req.id } }, w.lead)).rejects.toBeInstanceOf(InvalidTargetError);
      const a = await act(q, { type: "assignTarget", target: { kind: "user", userId: w.dev1.id } }, w.lead);
      expect(a).toMatchObject({ status: "assigned", targetUserId: w.dev1.id });
      await expect(
        act(a, { type: "transfer", target: { kind: "user", userId: w.outsider.id }, reason: "x" }, w.dev1),
      ).rejects.toBeInstanceOf(InvalidTargetError);
      const [row] = await db.select().from(tickets).where(eq(tickets.id, a.id));
      expect(row.version).toBe(a.version);
    });

    test("프로젝트에서 빠진 사람 대상은 거부", async () => {
      const gone = await signUp(createAuth(db), "gone@example.com", "빠짐");
      const d = await createDraft(db, draftInput(w.project.id, w.req.id));
      await expect(act(d, { type: "submit", target: { kind: "user", userId: gone.id } }, w.req)).rejects.toThrow("대상이 이 프로젝트에 없어요");
    });

    test("reopenClosed는 닫기 전 담당자 리스트로 돌려보낸다(assigneeId 폴백)", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const p = await act(t, { type: "claim" }, w.dev1);
      const c = await act(p, { type: "close", reason: "other", note: "정리" }, w.lead);
      const r = await act(c, { type: "reopenClosed" }, w.lead);
      expect(r).toMatchObject({ status: "assigned", targetUserId: w.dev1.id, assigneeId: null });
    });
  });

  describe("알림", () => {
    test("그룹 큐로 제출하면 그룹원 전원 알림, 작성자 제외", async () => {
      // 작성자가 그룹원(dev1)인 경우: 본인은 빠지고 dev2만
      const d = await createDraft(db, draftInput(w.project.id, w.dev1.id));
      const t = await act(d, { type: "submit", target: { kind: "group", groupId: w.g1.id } }, w.dev1);
      expect(await notifiedUsers(t.id, "submit")).toEqual([w.dev2.id]);
      // 요청자가 제출하면 그룹원 전원
      const t2 = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      expect(await notifiedUsers(t2.id, "submit")).toEqual([w.dev1.id, w.dev2.id].sort());
      const [n] = await db.select().from(notifications).where(eq(notifications.ticketId, t2.id));
      expect(n.readAt).toBeNull();
      const ev = (await events(t2.id)).find((e) => e.type === "submit")!;
      expect(n.eventId).toBe(ev.id);
    });
    test("사람 대상 → 그 사람, 리드 큐 → lead 전원", async () => {
      const t = await submitted(w.req, { kind: "user", userId: w.dev3.id });
      expect(await notifiedUsers(t.id)).toEqual([w.dev3.id]);
      const q = await submitted(w.req, null);
      expect(await notifiedUsers(q.id)).toEqual([w.lead.id, w.lead2.id].sort());
      // lead가 제출자일 때는 자기 제외
      const d = await createDraft(db, draftInput(w.project.id, w.lead.id));
      const q2 = await act(d, { type: "submit", target: null }, w.lead);
      expect(await notifiedUsers(q2.id)).toEqual([w.lead2.id]);
    });
    test("resolve: 형식이 틀린 linkedRefs는 InvalidLinkedRefError로 거부하고 티켓은 그대로다, SHA는 소문자로", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const c = await act(t, { type: "claim" }, w.dev1);
      for (const bad of [["pr:abc"], ["commit:xyz1234"], ["javascript:alert(1)"], ["ticket:../../admin"], Array.from({ length: 11 }, (_, i) => `pr:${i + 1}`)]) {
        await expect(act(c, { type: "resolve", linkedRefs: bad }, w.dev1)).rejects.toBeInstanceOf(InvalidLinkedRefError);
      }
      const [still] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(still.status).toBe("in_progress");
      expect(still.version).toBe(c.version);
      await act(c, { type: "resolve", linkedRefs: ["commit:ABCDEF1", "pr:007"] }, w.dev1);
      const [ev] = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "resolve")));
      expect(ev.to).toMatchObject({ linkedRefs: ["commit:abcdef1", "pr:7"] });
    });

    test("accept/claim/hold/resume → 작성자, resolve → 작성자+구독자, reopen → 담당자, close → 작성자+담당자+구독자", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      await subscribe(db, t.id, w.lead2.id);
      await subscribe(db, t.id, w.lead2.id); // 멱등
      expect(await db.select().from(ticketSubscriptions).where(and(eq(ticketSubscriptions.ticketId, t.id), eq(ticketSubscriptions.userId, w.lead2.id)))).toHaveLength(1);
      const c = await act(t, { type: "claim" }, w.dev1);
      expect(await notifiedUsers(t.id, "claim")).toEqual([w.req.id]);
      const h = await act(c, { type: "hold", reason: "r" }, w.dev1);
      expect(await notifiedUsers(t.id, "hold")).toEqual([w.req.id]);
      const rs = await act(h, { type: "resume" }, w.dev1);
      expect(await notifiedUsers(t.id, "resume")).toEqual([w.req.id]);
      const r = await act(rs, { type: "resolve", linkedRefs: ["pr:12", " commit:abc1234 ", "pr:12", ""] }, w.dev1);
      // 링크한 PR/커밋은 이벤트에 남는다(요청자 확인 화면이 보여 준다). 공백·중복은 정리한다.
      const [resolveEvent] = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "resolve")));
      expect(resolveEvent.to).toMatchObject({ status: "resolved", linkedRefs: ["pr:12", "commit:abc1234"] });
      // 작성자 + 구독자(작성자, lead2), 행위자 dev1 제외, 중복 없음
      expect(await notifiedUsers(t.id, "resolve")).toEqual([w.lead2.id, w.req.id].sort());
      const ro = await act(r, { type: "reopen", reason: "아직 안 고쳐짐" }, w.req);
      expect(await notifiedUsers(t.id, "reopen")).toEqual([w.dev1.id]);
      const cl = await act(ro, { type: "close", reason: "wont_do" }, w.lead);
      expect(await notifiedUsers(t.id, "close")).toEqual([w.dev1.id, w.lead2.id, w.req.id].sort());
      expect(cl.status).toBe("closed");
    });
    test("accept → 작성자", async () => {
      const t = await submitted(w.req, { kind: "user", userId: w.dev3.id });
      await act(t, { type: "accept" }, w.dev3);
      expect(await notifiedUsers(t.id, "accept")).toEqual([w.req.id]);
    });
  });

  describe("중복 종결", () => {
    test("작성자와 구독자가 원본 티켓 구독자가 된다", async () => {
      const orig = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const author2 = await signUp(createAuth(db), "author2@example.com", "작성자2");
      await addMember(createAuth(db), w.orgId, author2.id, "requester");
      const dupT = await submitted(author2, { kind: "group", groupId: w.g1.id });
      await subscribe(db, dupT.id, w.dev3.id);
      const c = await act(dupT, { type: "claim" }, w.dev1);
      await act(c, { type: "close", reason: "duplicate", duplicateOfId: orig.id }, w.dev1);
      const subs = (await db.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, orig.id))).map((s) => s.userId);
      expect(subs.sort()).toEqual([w.req.id, author2.id, w.dev3.id].sort());
      const [row] = await db.select().from(tickets).where(eq(tickets.id, dupT.id));
      expect(row).toMatchObject({ status: "closed", closeReason: "duplicate", duplicateOfId: orig.id });
    });
    test("원본이 없거나 다른 프로젝트이거나 자기 자신이면 명확한 에러", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const c = await act(t, { type: "claim" }, w.dev1);
      const foreign = await createDraft(db, draftInput(w.otherProject.id, w.outsider.id));
      for (const id of ["00000000-0000-0000-0000-000000000000", "not-a-uuid", foreign.id, t.id]) {
        const err = await act(c, { type: "close", reason: "duplicate", duplicateOfId: id }, w.dev1).catch((e) => e);
        expect(err).toBeInstanceOf(InvalidDuplicateError);
      }
      const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(row.version).toBe(c.version);
    });
    test("R24: 제출되지 않은 티켓(초안·검토 중·철회)은 중복 원본이 될 수 없고 구독도 옮겨지지 않는다", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const c = await act(t, { type: "claim" }, w.dev1);
      const draft = await createDraft(db, draftInput(w.project.id, w.req.id));
      const reviewing = await createDraft(db, draftInput(w.project.id, w.req.id));
      await db.update(tickets).set({ status: "ai_reviewing" }).where(eq(tickets.id, reviewing.id));
      const withdrawn = await createDraft(db, draftInput(w.project.id, w.req.id));
      await db.update(tickets).set({ status: "withdrawn_ai_resolved", withdrawKind: "already_resolved" }).where(eq(tickets.id, withdrawn.id));
      for (const origin of [draft, reviewing, withdrawn]) {
        const err = await act(c, { type: "close", reason: "duplicate", duplicateOfId: origin.id }, w.dev1).catch((e) => e);
        expect(err).toBeInstanceOf(InvalidDuplicateError);
        const subs = await db.select().from(ticketSubscriptions).where(eq(ticketSubscriptions.ticketId, origin.id));
        expect(subs.map((x) => x.userId)).toEqual([w.req.id]);
      }
      const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(row.version).toBe(c.version);
    });
  });

  describe("setUrgency", () => {
    test("사람이 바꾸면 이벤트 urgency_changed, version+1", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const u = await setUrgency(db, { ticketId: t.id, to: "urgent", actorId: w.lead.id });
      expect(u).toMatchObject({ urgency: "urgent", version: t.version + 1 });
      const ev = (await events(t.id)).find((e) => e.type === "urgency_changed")!;
      expect(ev).toMatchObject({ actorId: w.lead.id, actorKind: "user", from: { urgency: "normal" }, to: { urgency: "urgent" } });
    });
    test("작성자는 제출 후에도 바꿀 수 있다(R11)", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const u = await setUrgency(db, { ticketId: t.id, to: "low", actorId: w.req.id });
      expect(u).toMatchObject({ urgency: "low", version: t.version + 1 });
    });
    test("개발자(작성자 아님)·작성자 아닌 요청자·비멤버는 거부, 같은 값이면 변화 없음", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      await expect(setUrgency(db, { ticketId: t.id, to: "high", actorId: w.dev1.id })).rejects.toBeInstanceOf(ForbiddenError);
      const auth = createAuth(db);
      const req2 = await signUp(auth, "req2@example.com", "요청자2");
      await addMember(auth, w.orgId, req2.id, "requester");
      await expect(setUrgency(db, { ticketId: t.id, to: "high", actorId: req2.id })).rejects.toBeInstanceOf(ForbiddenError);
      await expect(setUrgency(db, { ticketId: t.id, to: "high", actorId: w.outsider.id })).rejects.toBeInstanceOf(ForbiddenError);
      const same = await setUrgency(db, { ticketId: t.id, to: "normal", actorId: w.lead.id });
      expect(same.version).toBe(t.version);
    });
    test("종결된 티켓은 작성자도 바꿀 수 없다", async () => {
      const t = await submitted(w.req, null);
      const c = await act(t, { type: "close", reason: "other", note: "정리" }, w.lead);
      await expect(setUrgency(db, { ticketId: c.id, to: "high", actorId: w.req.id })).rejects.toBeInstanceOf(ForbiddenError);
    });
    test("작성자는 제출 전(draft)에는 바꿀 수 있다", async () => {
      const d = await createDraft(db, draftInput(w.project.id, w.req.id));
      expect((await setUrgency(db, { ticketId: d.id, to: "high", actorId: w.req.id })).urgency).toBe("high");
    });
  });

  describe("proposeWontDo", () => {
    test("담당자만, 상태 그대로, lead 전원 알림(본인 제외)", async () => {
      const t = await submitted(w.req, { kind: "group", groupId: w.g1.id });
      const c = await act(t, { type: "claim" }, w.dev1);
      await expect(proposeWontDo(db, { ticketId: t.id, actorId: w.dev2.id, reason: "x" })).rejects.toThrow();
      await expect(proposeWontDo(db, { ticketId: t.id, actorId: w.dev1.id, reason: "  " })).rejects.toThrow();
      const r = await proposeWontDo(db, { ticketId: t.id, actorId: w.dev1.id, reason: "범위 밖" });
      expect(r).toMatchObject({ status: "in_progress", version: c.version });
      const ev = (await events(t.id)).find((e) => e.type === "wont_do_proposed")!;
      expect(ev).toMatchObject({ actorId: w.dev1.id, reason: "범위 밖" });
      expect(await notifiedUsers(t.id, "wont_do_proposed")).toEqual([w.lead.id, w.lead2.id].sort());
    });
    test("담당자가 리드이면 다른 lead에게만", async () => {
      const t = await submitted(w.req, null);
      const c = await act(t, { type: "claim" }, w.lead);
      await proposeWontDo(db, { ticketId: c.id, actorId: w.lead.id, reason: "안 함" });
      expect(await notifiedUsers(t.id, "wont_do_proposed")).toEqual([w.lead2.id]);
    });
  });

  describe("groups 서비스", () => {
    test("upsertGroup은 같은 이름이면 갱신", async () => {
      const g = await upsertGroup(db, { projectId: w.project.id, name: "인프라", scopeDescription: "a", repoTags: ["x"] });
      const g2 = await upsertGroup(db, { projectId: w.project.id, name: "인프라", scopeDescription: "b", repoTags: ["y"] });
      expect(g2).toMatchObject({ id: g.id, scopeDescription: "b", repoTags: ["y"] });
    });
    test("setGroupMembers는 요청자·비멤버를 거부하고 전체를 교체한다", async () => {
      const g = await upsertGroup(db, { projectId: w.project.id, name: "멤버테스트", scopeDescription: "", repoTags: [] });
      await expect(setGroupMembers(db, g.id, [w.req.id])).rejects.toBeInstanceOf(InvalidTargetError);
      await expect(setGroupMembers(db, g.id, [w.outsider.id])).rejects.toBeInstanceOf(InvalidTargetError);
      await setGroupMembers(db, g.id, [w.dev1.id, w.lead.id]);
      await setGroupMembers(db, g.id, [w.dev2.id]);
      const ms = await db.select().from(groupMembers).where(eq(groupMembers.groupId, g.id));
      expect(ms.map((m) => m.userId)).toEqual([w.dev2.id]);
    });
    test("그룹 삭제 시 대기 티켓은 리드 큐로, 이벤트 group_deleted", async () => {
      const g = await upsertGroup(db, { projectId: w.project.id, name: "곧삭제", scopeDescription: "", repoTags: [] });
      await setGroupMembers(db, g.id, [w.dev3.id]);
      const waiting = await submitted(w.req, { kind: "group", groupId: g.id });
      const active = await act(await submitted(w.req, { kind: "group", groupId: g.id }), { type: "claim" }, w.dev3);
      await deleteGroup(db, g.id, w.lead.id);
      const [row] = await db.select().from(tickets).where(eq(tickets.id, waiting.id));
      expect(row).toMatchObject({ status: "queued", targetGroupId: null, targetUserId: null, version: waiting.version + 1 });
      const ev = (await events(waiting.id)).find((e) => e.type === "group_deleted")!;
      expect(ev).toMatchObject({ actorId: w.lead.id });
      expect(ev.from).toMatchObject({ targetGroupId: g.id });
      // 진행 중 티켓은 그대로
      const [a] = await db.select().from(tickets).where(eq(tickets.id, active.id));
      expect(a.status).toBe("in_progress");
      expect(await db.select().from(groups).where(eq(groups.id, g.id))).toHaveLength(0);
      // 이제 리드 큐이므로 lead가 가져갈 수 있다
      const claimed = await act(row, { type: "claim" }, w.lead);
      expect(claimed.status).toBe("in_progress");
    });
  });
});

// 진짜 경쟁은 연결이 여럿인 Postgres에서만 만들 수 있다(PGlite는 단일 연결이라 트랜잭션이 직렬화된다).
const hasPg = await pgAvailable();

describe.skipIf(!hasPg)("낙관적 잠금: 진짜 Postgres에서의 경쟁", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof buildWorld>>;
  beforeAll(async () => {
    ({ db, close } = await createPgTestDb());
    w = await buildWorld(db);
  });
  afterAll(async () => close());

  test("서로 다른 연결의 두 트랜잭션이 같은 version을 읽고 동시에 claim → 한 명만 성공", async () => {
    for (let i = 0; i < 5; i++) {
      const d = await createDraft(db, draftInput(w.project.id, w.req.id));
      const t = await performAction(db, {
        ticketId: d.id,
        expectedVersion: d.version,
        action: { type: "submit", target: { kind: "group", groupId: w.g1.id } },
        actor: await getActorCtx(db, w.project.id, w.req.id),
      });
      const actors: ActorCtx[] = [
        await getActorCtx(db, w.project.id, w.dev1.id),
        await getActorCtx(db, w.project.id, w.dev2.id),
      ];
      const rs = await Promise.allSettled(
        actors.map((actor) => performAction(db, { ticketId: t.id, expectedVersion: t.version, action: { type: "claim" }, actor })),
      );
      expect(rs.filter((r) => r.status === "fulfilled")).toHaveLength(1);
      const rejected = rs.find((r) => r.status === "rejected") as PromiseRejectedResult;
      expect(rejected.reason).toBeInstanceOf(ConflictError);
      const [row] = await db.select().from(tickets).where(eq(tickets.id, t.id));
      expect(row.version).toBe(t.version + 1);
      expect((await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "claim"))))).toHaveLength(1);
    }
  });
});
