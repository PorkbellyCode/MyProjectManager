import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { aiJudgments, comments, ticketEvents, ticketReviewTurns } from "@/lib/db/schema";
import { getActiveProfile, ensureDefaultProfiles } from "@/lib/agents/profiles";
import { addComment } from "@/lib/comments/service";
import { createDraft } from "@/lib/tickets/service";
import { getTimeline } from "@/lib/tickets/timeline";

const at = (s: number) => new Date(Date.UTC(2026, 10, 24, 0, 0, s));

describe("getTimeline (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());

  async function setup(slug: string) {
    const auth = createAuth(db);
    const lead = await signUp(auth, `${slug}-l@x.com`, "리드");
    const req = await signUp(auth, `${slug}-r@x.com`, "요청자");
    const { project, orgId } = await makeProject(db, auth, slug, lead.id);
    await addMember(auth, orgId, req.id, "requester");
    await ensureDefaultProfiles(db, project.id, lead.id);
    const profile = await getActiveProfile(db, project.id, "resolver");
    const t = await createDraft(db, { projectId: project.id, authorId: req.id, title: "t", body: "b", category: "defect", urgency: "normal" });
    const judgment = (status: "ok" | "failed" | "discarded", when: Date, extra: Partial<typeof aiJudgments.$inferInsert> = {}) =>
      db
        .insert(aiJudgments)
        .values({
          ticketId: t.id,
          projectId: project.id,
          role: "resolver",
          stage: "resolve",
          profileVersionId: profile.versionId,
          input: {},
          output: { kind: "none" },
          evidence: [{ type: "ticket", id: "x" }],
          steps: [],
          status,
          inputTokens: 11,
          outputTokens: 22,
          traceId: "trace-1",
          createdAt: when,
          ...extra,
        })
        .returning()
        .then((r) => r[0]);
    return { project, lead, req, t, profile, judgment };
  }

  test("이벤트·AI 판단·검토 턴·댓글을 시간순으로 병합하고 행위자를 구분한다", async () => {
    const s = await setup("tl-a");
    const [created] = await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, s.t.id));
    await db.update(ticketEvents).set({ createdAt: at(1) }).where(eq(ticketEvents.id, created.id));
    await db.insert(ticketEvents).values({ ticketId: s.t.id, actorId: null, actorKind: "system", type: "stageReady", createdAt: at(5) });
    const j = await s.judgment("ok", at(2));
    await db.insert(ticketReviewTurns).values({
      ticketId: s.t.id,
      stage: "resolve",
      kind: "resolution",
      payload: { message: "m" },
      judgmentId: j.id,
      createdAt: at(3),
    });
    const c = await addComment(db, { ticketId: s.t.id, authorId: s.lead.id, body: "댓글" });
    await db.update(comments).set({ createdAt: at(4) }).where(eq(comments.id, c.id));
    await db.update(ticketEvents).set({ createdAt: at(4) }).where(eq(ticketEvents.type, "commented"));

    const tl = await getTimeline(db, s.t.id);
    expect(tl.map((i) => i.kind)).toEqual(["event", "judgment", "review_turn", "event", "comment", "event"]);
    expect(tl.map((i) => i.at.getTime())).toEqual([...tl.map((i) => i.at.getTime())].sort((a, b) => a - b));

    expect(tl[0]).toMatchObject({ actor: { kind: "user", name: "요청자" }, data: { type: "created" } });
    expect(tl[5].actor).toEqual({ kind: "system" });
    const [, judgment, turn, , comment] = tl;
    expect(judgment.actor).toMatchObject({ kind: "ai", provider: s.profile.modelId.split(":")[0] });
    expect(judgment.data).toMatchObject({
      status: "ok",
      role: "resolver",
      evidence: [{ type: "ticket", id: "x" }],
      profileVersionId: s.profile.versionId,
      profileVersion: s.profile.version,
      inputTokens: 11,
      outputTokens: 22,
      traceId: "trace-1",
      modelId: s.profile.modelId,
    });
    expect(turn.actor).toMatchObject({ kind: "ai", provider: s.profile.modelId.split(":")[0] });
    expect(turn.data).toMatchObject({ kind: "resolution", stage: "resolve" });
    expect(comment.actor).toEqual({ kind: "user", name: "리드" });
    expect(comment.data).toMatchObject({ body: "댓글" });
  });

  test("discarded 판단은 제외, failed는 포함", async () => {
    const s = await setup("tl-b");
    await s.judgment("discarded", at(1));
    const f = await s.judgment("failed", at(2), { error: "boom" });
    const tl = (await getTimeline(db, s.t.id)).filter((i) => i.kind === "judgment");
    expect(tl).toHaveLength(1);
    expect(tl[0].data).toMatchObject({ id: f.id, status: "failed", error: "boom" });
  });

  test("같은 시각이면 event, judgment, review_turn, comment 순, 그다음 id", async () => {
    const s = await setup("tl-c");
    const when = at(9);
    const [ev0] = await db.select().from(ticketEvents).where(eq(ticketEvents.ticketId, s.t.id));
    await db.update(ticketEvents).set({ createdAt: when }).where(eq(ticketEvents.id, ev0.id));
    await db.insert(comments).values([
      { ticketId: s.t.id, authorId: s.req.id, body: "b", createdAt: when, id: "00000000-0000-4000-8000-000000000002" },
      { ticketId: s.t.id, authorId: s.req.id, body: "a", createdAt: when, id: "00000000-0000-4000-8000-000000000001" },
    ]);
    await db.insert(ticketReviewTurns).values({ ticketId: s.t.id, stage: "dedup", kind: "ready", payload: {}, createdAt: when });
    await s.judgment("ok", when);
    const tl = await getTimeline(db, s.t.id);
    expect(tl.map((i) => i.kind)).toEqual(["event", "judgment", "review_turn", "comment", "comment"]);
    expect(tl.slice(3).map((i) => (i.data as unknown as { body: string }).body)).toEqual(["a", "b"]);
  });

  test("다른 티켓의 항목은 섞이지 않는다", async () => {
    const s = await setup("tl-d");
    const s2 = await setup("tl-e");
    await addComment(db, { ticketId: s2.t.id, authorId: s2.lead.id, body: "남의 댓글" });
    expect((await getTimeline(db, s.t.id)).every((i) => i.kind === "event")).toBe(true);
  });
});
