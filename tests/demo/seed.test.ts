import fs from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { and, eq } from "drizzle-orm";

vi.mock("@/lib/env", () => ({ env: { MPM_FAKE_AI: "1" } }));
vi.mock("next/server", () => ({ after: () => {}, connection: async () => {} }));

import { createTestDb } from "../helpers/db";
import { makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { domainDocs, tickets } from "@/lib/db/schema";
import { respondWithRules } from "@/lib/ai/fake-rules";
import { seedDemo, countSeed } from "@/lib/demo/seed";
import { splitHandover } from "@/lib/demo/handover";
import { DEMO_PROJECT_NAME, DOMAIN_DOC_TITLES, SEED_TICKET_TITLES } from "@/lib/demo/seed-data";
import { normalizeResolve, loadEvidenceCtx } from "@/lib/review/normalize";
import { analyzeRepo } from "@/lib/agents/repo-analyst";
import { createDraft } from "@/lib/tickets/service";

const handoverMarkdown = fs.readFileSync(path.resolve(__dirname, "../../docs/demo/workwrap-handover.md"), "utf8");

/** 시스템 지시의 "# 이번 작업" 줄과 ticketPrompt 모양만 흉내 낸 호출 문맥. */
function ctxFor(task: string, ticket: { id: string; title: string; body: string }) {
  return {
    modelId: "fake:m",
    prompt: [
      { role: "system", content: `지시\n\n# 이번 작업: ${task}\n` },
      { role: "user", content: `검토 중인 티켓 id: ${ticket.id}\n제목: ${ticket.title}\n분류: defect\n긴급도: normal\n\n본문:\n${ticket.body}\n` },
    ],
  };
}

describe("시연 시드", () => {
  let db: Db;
  let close: () => Promise<void>;
  let projectId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const auth = createAuth(db);
    const r1 = await seedDemo(db, auth, { handoverMarkdown });
    projectId = r1.projectId;
  }, 120_000);
  afterAll(() => close());

  test("두 번째 실행은 아무것도 더하지 않는다", async () => {
    const before = await countSeed(db, projectId);
    const again = await seedDemo(db, createAuth(db), { handoverMarkdown });
    expect(again.projectId).toBe(projectId);
    expect(again.created).toEqual({ users: 0, tickets: 0, project: false });
    expect(await countSeed(db, projectId)).toEqual(before);
    expect(before).toMatchObject({ users: 7, projects: 1, members: 7, groups: 4, groupMembers: 4, domainDocs: 6, tickets: 4, comments: 4 });
  });

  test("과거 티켓은 실제 이벤트와 함께 종결·진행 중이다", async () => {
    const rows = await db.select({ title: tickets.title, status: tickets.status, closeReason: tickets.closeReason }).from(tickets).where(eq(tickets.projectId, projectId));
    const by = Object.fromEntries(rows.map((r) => [r.title, r]));
    expect(by[SEED_TICKET_TITLES.pinned]).toMatchObject({ status: "closed", closeReason: "resolved_confirmed" });
    expect(by[SEED_TICKET_TITLES.restore]).toMatchObject({ status: "closed", closeReason: "resolved_confirmed" });
    expect(by[SEED_TICKET_TITLES.limit]).toMatchObject({ status: "closed", closeReason: "resolved_confirmed" });
    expect(by[SEED_TICKET_TITLES.dup]).toMatchObject({ status: "in_progress" });
  });

  test("도메인 문서는 인수인계 문서의 ### 제목으로 잘린다", () => {
    const docs = splitHandover(handoverMarkdown);
    expect(docs.map((d) => d.title)).toEqual(Object.values(DOMAIN_DOC_TITLES));
    expect(docs.find((d) => d.title === DOMAIN_DOC_TITLES.rules)!.body).toContain("**버전 번호는 한번 붙으면 바뀌지 않는다.**");
    expect(docs.find((d) => d.title === DOMAIN_DOC_TITLES.states)!.body).toContain("`pending` → `active`");
  });

  test("시드 규칙: 시드 프로젝트에서만 근거 있는 해소가 나오고, 근거는 정규화를 통과한다", async () => {
    // 레포 분석을 돌려 최신 성공 스냅샷(커밋 a69abef)을 만든다.
    await analyzeRepo(db, projectId);
    const [draft] = await db.select().from(tickets).where(and(eq(tickets.projectId, projectId), eq(tickets.title, SEED_TICKET_TITLES.dup)));
    const author = draft.authorId;
    const t = await createDraft(db, { projectId, authorId: author, title: "메모 이어가기 버튼이 없어졌어요", body: "버튼이 안 보여요", category: "defect", urgency: "normal" });
    const raw = (await respondWithRules(ctxFor("해소 확인", t), db)) as Parameters<typeof normalizeResolve>[0];
    const ctx = await loadEvidenceCtx(db, projectId);
    const res = normalizeResolve(raw, ctx, t.id);
    expect(res?.kind).toBe("already_resolved");
    expect(res?.strength).toBe("strong");
    expect(res?.evidence.map((e) => e.ref.split(":")[0]).sort()).toEqual(["commit", "ticket"]);

    const v = await createDraft(db, { projectId, authorId: author, title: "요약 버전이 v1, v3으로 비어 있어요", body: "v2가 없어요", category: "defect", urgency: "normal" });
    const rawV = (await respondWithRules(ctxFor("해소 확인", v), db)) as Parameters<typeof normalizeResolve>[0];
    const resV = normalizeResolve(rawV, ctx, v.id);
    expect(resV?.kind).toBe("expected_behavior");
    const [rules] = await db.select({ id: domainDocs.id }).from(domainDocs).where(and(eq(domainDocs.projectId, projectId), eq(domainDocs.title, DOMAIN_DOC_TITLES.rules)));
    expect(resV?.evidence).toEqual([expect.objectContaining({ ref: `doc:${rules.id}` })]);

    const rec = (await respondWithRules(ctxFor("대상 추천", t), db)) as { target: { groupId: string } };
    expect(rec.target.groupId).toBeTruthy();
  }, 60_000);

  test("다른 프로젝트에서는 시드 규칙이 맞지 않는다", async () => {
    const auth = createAuth(db);
    const lead = await signUp(auth, "other-lead@x.com", "다른 리드");
    const other = await makeProject(db, auth, "other-demo", lead.id, { isDemo: true, name: DEMO_PROJECT_NAME + " 복제" });
    const t = await createDraft(db, { projectId: other.project.id, authorId: lead.id, title: "메모 이어가기 버튼이 없어졌어요", body: "안 보여요", category: "defect", urgency: "normal" });
    expect(await respondWithRules(ctxFor("해소 확인", t), db)).toEqual({ kind: "none", message: "", evidence: [] });
  });
});
