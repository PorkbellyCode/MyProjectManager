import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { addMember, makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { domainDocs, repoSnapshots, tickets } from "@/lib/db/schema";
import { createDraft, performAction } from "@/lib/tickets/service";
import { upsertGroup, setGroupMembers } from "@/lib/groups/service";
import { searchSimilarTickets } from "@/lib/tickets/search";
import { buildTools, type ToolContext } from "@/lib/agents/tools";
import { loadEvidenceCtx } from "@/lib/review/normalize";
import { getActorCtx } from "@/lib/tickets/service";
import type { RepoFacts } from "@/lib/repo/source";

let db: Db;
let close: () => Promise<void>;
let projectId: string;
let otherProjectId: string;
let leadId: string;
let devId: string;
let groupId: string;
let open: { id: string; number: number };
let withdrawn: { id: string };
let draft: { id: string };
let otherTicket: { id: string };

const run = async (ctx: ToolContext, name: keyof ReturnType<typeof buildTools>, input: unknown) => {
  const t = buildTools(ctx)[name] as { execute: (i: unknown, o: unknown) => Promise<unknown> };
  return t.execute(input, { toolCallId: "x", messages: [] });
};

async function submit(ticketId: string) {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  const actor = await getActorCtx(db, t.projectId, t.authorId);
  return performAction(db, { ticketId, expectedVersion: t.version, action: { type: "submit", target: null }, actor });
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const auth = createAuth(db);
  const lead = await signUp(auth, "lead@example.com", "리드");
  const dev = await signUp(auth, "dev@example.com", "개발자");
  leadId = lead.id;
  devId = dev.id;
  const p = await makeProject(db, auth, "tools-a", lead.id);
  projectId = p.project.id;
  await addMember(auth, p.orgId, dev.id, "developer");
  const o = await makeProject(db, auth, "tools-b", lead.id);
  otherProjectId = o.project.id;

  const mk = (pid: string, title: string, body = "") =>
    createDraft(db, { projectId: pid, authorId: leadId, title, body, category: "defect", urgency: "normal" });
  const g = await upsertGroup(db, { projectId, name: "프론트", scopeDescription: "화면", repoTags: [] });
  groupId = g.id;
  await setGroupMembers(db, groupId, [devId]);

  const t1 = await mk(projectId, "결제 화면 오류", "결제 버튼을 누르면 오류가 나요");
  open = t1;
  await submit(t1.id);
  const t2 = await mk(projectId, "결제 취소 오류", "결제 취소가 안돼요");
  withdrawn = t2;
  await db.update(tickets).set({ status: "withdrawn_ai_resolved" }).where(eq(tickets.id, t2.id));
  draft = await mk(projectId, "결제 초안 오류", "결제 초안");
  otherTicket = await mk(otherProjectId, "결제 다른 프로젝트 오류", "결제");
  await submit(otherTicket.id);
});
afterAll(async () => {
  await close();
});

describe("searchSimilarTickets", () => {
  test("철회·초안 티켓과 다른 프로젝트 티켓은 제외하고, 자기 자신은 excludeId로 뺀다", async () => {
    const res = await searchSimilarTickets(db, projectId, "결제 오류");
    expect(res.map((r) => r.id)).toEqual([open.id]);
    expect(res[0]).toMatchObject({ number: open.number, title: "결제 화면 오류", status: "queued", closeReason: null, linkedRefs: [] });
    expect(typeof res[0].rank).toBe("number");
    expect(await searchSimilarTickets(db, projectId, "결제 오류", open.id)).toEqual([]);
    expect(await searchSimilarTickets(db, projectId, "전혀없는단어")).toEqual([]);
    expect(await searchSimilarTickets(db, projectId, "   ")).toEqual([]);
  });
});

describe("buildTools", () => {
  const ctx = () => ({ db, projectId, ticketId: null }) satisfies ToolContext;

  test("searchTickets는 철회 티켓을 제외한다", async () => {
    const res = (await run({ ...ctx(), ticketId: draft.id }, "searchTickets", { query: "결제 오류" })) as { id: string }[];
    expect(res.map((r) => r.id)).toEqual([open.id]);
    expect(res.map((r) => r.id)).not.toContain(withdrawn.id);
  });

  test("스냅샷 없음 → listRecentChanges, getRepoOverview는 available:false", async () => {
    expect(await run(ctx(), "listRecentChanges", {})).toEqual({ available: false });
    expect(await run(ctx(), "getRepoOverview", {})).toEqual({ available: false });
    expect(await run(ctx(), "getGroups", {})).toEqual([
      { groupId, name: "프론트", scopeDescription: "화면", repoTags: [], memberNames: ["개발자"] },
    ]);
  });

  test("getDomainDocs는 이 프로젝트 문서만 돌려준다", async () => {
    const [d] = await db.insert(domainDocs).values({ projectId, title: "결제 규칙", body: "환불은 7일" }).returning();
    await db.insert(domainDocs).values({ projectId: otherProjectId, title: "남의 문서", body: "x" });
    const res = (await run(ctx(), "getDomainDocs", {})) as { id: string; title: string; body: string }[];
    expect(res).toEqual([{ id: d.id, title: "결제 규칙", body: "환불은 7일" }]);
  });

  test("최신 ok 스냅샷을 쓴다(failed가 더 새로워도). facts null이면 변경 목록은 available:false", async () => {
    const facts: RepoFacts = {
      sourceKind: "github", repoLabel: "a/b", defaultBranch: "main", paths: [], manifests: {}, readme: null,
      commits: [{ sha: "abcdef1234567890", message: "fix pay", date: "2026-11-01", url: null }],
      pulls: [{ number: 12, title: "pay fix", state: "closed", mergedAt: "2026-11-02", url: null }],
      truncated: false,
    };
    const overview = {
      stack: ["Next.js"],
      modules: [{ path: "src/pay", summary: "결제", groupId }],
      screens: [{ path: "src/app/pay", name: "결제", groupId: null }],
      apis: [{ path: "src/api/pay", method: "POST", groupId }],
      domains: [],
    };
    await db.insert(repoSnapshots).values({ projectId, facts, overview, status: "ok", createdAt: new Date("2026-11-03") });
    await db.insert(repoSnapshots).values({ projectId, facts: null, overview: null, status: "failed", error: "x", createdAt: new Date("2026-11-04") });

    expect(await run(ctx(), "getRepoOverview", {})).toMatchObject({ available: true, overview: { stack: ["Next.js"] } });
    expect(await run(ctx(), "listRecentChanges", {})).toMatchObject({
      available: true,
      commits: [{ sha: "abcdef1234567890" }],
      pulls: [{ number: 12 }],
    });
    const groups = (await run(ctx(), "getGroups", {})) as { repoTags: string[] }[];
    expect(groups[0].repoTags).toEqual(["src/pay", "src/api/pay"]);

    const ev = await loadEvidenceCtx(db, projectId);
    expect(ev.commitShas.has("abcdef1234567890")).toBe(true);
    expect(ev.prNumbers.has(12)).toBe(true);
    expect(ev.docIds.size).toBe(1);
    expect(ev.ticketIds.get(open.id)).toEqual({ status: "queued", closeReason: null });
    expect(ev.ticketIds.has(otherTicket.id)).toBe(false);
  });

  test("ok 스냅샷의 facts가 null이어도 loadEvidenceCtx는 깨지지 않는다", async () => {
    const { db: db2, close: close2 } = await createTestDb();
    const ev = await loadEvidenceCtx(db2, "00000000-0000-4000-8000-000000000000");
    expect(ev.commitShas.size).toBe(0);
    await close2();
  });
});
