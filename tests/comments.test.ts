import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/db";
import { addMember, makeProject, signUp } from "./helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { notifications, ticketEvents } from "@/lib/db/schema";
import { addComment, EmptyCommentError } from "@/lib/comments/service";
import type { TicketAction } from "@/lib/tickets/state-machine";
import { setGroupMembers, upsertGroup } from "@/lib/groups/service";
import { createDraft, getActorCtx, performAction, subscribe, TicketNotFoundError } from "@/lib/tickets/service";

describe("addComment (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let w: Awaited<ReturnType<typeof world>>;

  async function world(db: Db) {
    const auth = createAuth(db);
    const lead = await signUp(auth, "lead@x.com", "리드");
    const dev = await signUp(auth, "dev@x.com", "개발");
    const sub = await signUp(auth, "sub@x.com", "구독자");
    const req = await signUp(auth, "req@x.com", "요청자");
    const out = await signUp(auth, "out@x.com", "외부인");
    const { project, orgId } = await makeProject(db, auth, "cm-proj", lead.id);
    await addMember(auth, orgId, dev.id, "developer");
    await addMember(auth, orgId, sub.id, "developer");
    await addMember(auth, orgId, req.id, "requester");
    await makeProject(db, auth, "cm-other", out.id);
    const g = await upsertGroup(db, { projectId: project.id, name: "백엔드", scopeDescription: "API", repoTags: [] });
    await setGroupMembers(db, g.id, [dev.id]);
    return { project, lead, dev, sub, req, out, g };
  }

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    w = await world(db);
  });
  afterAll(async () => close());

  const draft = (title = "t") =>
    createDraft(db, { projectId: w.project.id, authorId: w.req.id, title, body: "b", category: "defect", urgency: "normal" });
  const notified = async (ticketId: string, eventId?: string) =>
    (await db.select().from(notifications).where(eq(notifications.ticketId, ticketId)))
      .filter((n) => n.kind === "commented" && (!eventId || n.eventId === eventId))
      .map((n) => n.userId)
      .sort();

  test("빈 본문 거부, 본문은 다듬어 저장, commented 이벤트 1개", async () => {
    const t = await draft();
    await expect(addComment(db, { ticketId: t.id, authorId: w.lead.id, body: "   " })).rejects.toBeInstanceOf(EmptyCommentError);
    const c = await addComment(db, { ticketId: t.id, authorId: w.lead.id, body: " 안녕 " });
    expect(c.body).toBe("안녕");
    const evs = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "commented")));
    expect(evs).toHaveLength(1);
    expect(evs[0]).toMatchObject({ actorId: w.lead.id, actorKind: "user" });
  });

  test("비멤버는 티켓을 못 찾는 것과 같은 404 에러, 이벤트·댓글 없음", async () => {
    const t = await draft();
    await expect(addComment(db, { ticketId: t.id, authorId: w.out.id, body: "hi" })).rejects.toBeInstanceOf(TicketNotFoundError);
    await expect(addComment(db, { ticketId: "00000000-0000-0000-0000-000000000000", authorId: w.lead.id, body: "hi" })).rejects.toBeInstanceOf(
      TicketNotFoundError,
    );
    const evs = await db.select().from(ticketEvents).where(and(eq(ticketEvents.ticketId, t.id), eq(ticketEvents.type, "commented")));
    expect(evs).toHaveLength(0);
  });

  const act = async (t: { id: string; version: number }, action: TicketAction, who: { id: string }) =>
    performAction(db, {
      ticketId: t.id,
      expectedVersion: t.version,
      action,
      actor: await getActorCtx(db, w.project.id, who.id),
    });

  test("작성자 댓글 → 담당자(claim한 개발자)와 구독자만 알림, 작성자 본인 제외", async () => {
    const t = await draft();
    const sub1 = await act(t, { type: "submit", target: { kind: "group", groupId: w.g.id } }, w.req);
    const claimed = await act(sub1, { type: "claim" }, w.dev);
    expect(claimed.assigneeId).toBe(w.dev.id);
    await subscribe(db, t.id, w.sub.id);
    await subscribe(db, t.id, w.req.id);
    await addComment(db, { ticketId: t.id, authorId: w.req.id, body: "추가 정보예요" });
    expect(await notified(t.id)).toEqual([w.dev.id, w.sub.id].sort());
  });

  test("R1: assigned 상태에서는 지정된 대상 사람이 담당자로 알림을 받는다", async () => {
    const t = await draft();
    await act(t, { type: "submit", target: { kind: "user", userId: w.dev.id } }, w.req);
    await subscribe(db, t.id, w.sub.id);
    // submit 알림은 kind가 달라 걸러진다
    await addComment(db, { ticketId: t.id, authorId: w.req.id, body: "확인 부탁해요" });
    expect(await notified(t.id)).toEqual([w.dev.id, w.sub.id].sort());
  });

  test("담당자가 댓글을 달면 요청자와 구독자가 받고 담당자 본인은 제외", async () => {
    const t = await draft();
    const s1 = await act(t, { type: "submit", target: { kind: "group", groupId: w.g.id } }, w.req);
    await act(s1, { type: "claim" }, w.dev);
    await subscribe(db, t.id, w.sub.id);
    await addComment(db, { ticketId: t.id, authorId: w.dev.id, body: "확인 중이에요" });
    expect(await notified(t.id)).toEqual([w.req.id, w.sub.id].sort());
  });
});
