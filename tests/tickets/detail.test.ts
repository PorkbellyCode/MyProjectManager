import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";

vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));

import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
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
});
