import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { eq } from "drizzle-orm";
import { MockLanguageModelV4 } from "ai/test";
import { createTestDb } from "../helpers/db";
import { makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { groups, jobs, repoSnapshots } from "@/lib/db/schema";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { analyzeRepo, getLatestSnapshot, updateOverviewTags } from "@/lib/agents/repo-analyst";
import { RepoSourceError, type RepoFacts, type RepoSource } from "@/lib/repo/source";
import { enqueue, runPending } from "@/lib/jobs/queue";
import { handlers } from "@/lib/jobs/handlers";

let db: Db;
let close: () => Promise<void>;
let projectId: string;
let groupId: string;

const facts: RepoFacts = {
  sourceKind: "github",
  repoLabel: "acme/app",
  defaultBranch: "main",
  paths: ["src/summary/index.ts"],
  manifests: {},
  readme: null,
  commits: [],
  pulls: [],
  truncated: false,
};

const okSource: RepoSource = { fetchFacts: async () => facts };
const failingSource = (code: ConstructorParameters<typeof RepoSourceError>[0]): RepoSource => ({
  fetchFacts: async () => {
    throw new RepoSourceError(code, `boom ${code}`);
  },
});

function modelReturning(body: unknown, captured?: { prompts: unknown[]; system: unknown[] }) {
  return new MockLanguageModelV4({
    doGenerate: async (options) => {
      captured?.prompts.push(options.prompt);
      return {
        content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 5, noCache: 5, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 5, text: 5, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}

const overview = (gid: string | null) => ({
  stack: ["Next.js"],
  modules: [{ path: "src/summary", summary: "요약", groupId: gid }],
  screens: [{ path: "src/app/page.tsx", name: "홈", groupId: gid }],
  apis: [{ path: "src/api/summary", method: "GET", groupId: gid }],
  domains: [{ name: "요약", modulePaths: ["src/summary"] }],
});

const snapshots = () => db.select().from(repoSnapshots).where(eq(repoSnapshots.projectId, projectId));

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const auth = createAuth(db);
  const lead = await signUp(auth, "lead@example.com", "리드");
  projectId = (await makeProject(db, auth, "repo-a", lead.id)).project.id;
  await ensureDefaultProfiles(db, projectId, lead.id);
  const [g] = await db
    .insert(groups)
    .values({ projectId, name: "프론트", scopeDescription: "화면과 UI" })
    .returning();
  groupId = g.id;
});
afterAll(async () => {
  await close();
});

describe("analyzeRepo", () => {
  test("개요를 저장하고, 프롬프트에 그룹 목록을 넣고, 프로필 지시사항을 쓴다", async () => {
    const captured = { prompts: [] as unknown[], system: [] as unknown[] };
    const res = await analyzeRepo(db, projectId, { source: okSource, model: modelReturning(overview(groupId), captured) });
    expect(res.status).toBe("ok");
    const snap = await getLatestSnapshot(db, projectId);
    expect(snap).toMatchObject({ id: res.snapshotId, status: "ok", error: null });
    expect(snap?.facts).toMatchObject({ repoLabel: "acme/app" });
    expect(snap?.overview?.modules[0].groupId).toBe(groupId);
    const sent = JSON.stringify(captured.prompts[0]);
    expect(sent).toContain(groupId);
    expect(sent).toContain("프론트");
    expect(sent).toContain("화면과 UI");
    expect(sent).toContain("레포 분석 에이전트"); // 기본 'repo' 프로필 지시사항
  });

  test("존재하지 않는 groupId는 null로 고친다", async () => {
    const res = await analyzeRepo(db, projectId, {
      source: okSource,
      model: modelReturning(overview("11111111-1111-4111-8111-111111111111")),
    });
    const snap = await getLatestSnapshot(db, projectId);
    expect(snap?.id).toBe(res.snapshotId);
    expect(snap?.overview?.modules[0].groupId).toBeNull();
    expect(snap?.overview?.screens[0].groupId).toBeNull();
    expect(snap?.overview?.apis[0].groupId).toBeNull();
  });

  test.each(["not_found", "unauthorized"] as const)("출처 오류 %s: failed 스냅샷을 남기고 정상 반환", async (code) => {
    const before = (await snapshots()).length;
    const res = await analyzeRepo(db, projectId, { source: failingSource(code), model: modelReturning({}) });
    expect(res.status).toBe("failed");
    expect(await snapshots()).toHaveLength(before + 1);
    const snap = await getLatestSnapshot(db, projectId);
    expect(snap).toMatchObject({ status: "failed", overview: null, facts: null });
    expect(snap?.error).toContain(code);
  });

  test.each(["rate_limited", "unknown"] as const)("출처 오류 %s: failed 스냅샷을 남기고 다시 던진다", async (code) => {
    const before = (await snapshots()).length;
    await expect(analyzeRepo(db, projectId, { source: failingSource(code) })).rejects.toMatchObject({ code });
    expect(await snapshots()).toHaveLength(before + 1);
    expect((await getLatestSnapshot(db, projectId))?.status).toBe("failed");
  });

  test("AI가 스키마에 맞지 않는 답을 하면 failed 스냅샷(facts는 보존), 던지지 않는다", async () => {
    const res = await analyzeRepo(db, projectId, { source: okSource, model: modelReturning({ nope: true }) });
    expect(res.status).toBe("failed");
    const snap = await getLatestSnapshot(db, projectId);
    expect(snap).toMatchObject({ status: "failed", overview: null });
    expect(snap?.facts).toMatchObject({ repoLabel: "acme/app" });
    expect(snap?.error).toBeTruthy();
  });
});

describe("updateOverviewTags", () => {
  test("path별로 그룹 태그를 고치고, 다른 프로젝트 그룹은 거부한다", async () => {
    const { snapshotId } = await analyzeRepo(db, projectId, { source: okSource, model: modelReturning(overview(null)) });
    const updated = await updateOverviewTags(db, snapshotId, {
      modules: { "src/summary": groupId },
      apis: { "src/api/summary": groupId },
    });
    expect(updated.overview?.modules[0].groupId).toBe(groupId);
    expect(updated.overview?.apis[0].groupId).toBe(groupId);
    expect(updated.overview?.screens[0].groupId).toBeNull();

    await expect(
      updateOverviewTags(db, snapshotId, { modules: { "src/summary": "22222222-2222-4222-8222-222222222222" } }),
    ).rejects.toThrow();
    const cleared = await updateOverviewTags(db, snapshotId, { modules: { "src/summary": null } });
    expect(cleared.overview?.modules[0].groupId).toBeNull();
  });
});

describe("repo.analyze 핸들러", () => {
  test("등록돼 있고 payload 오류면 작업이 재시도 대상이 된다", async () => {
    expect(handlers["repo.analyze"]).toBeTypeOf("function");
    const id = await enqueue(db, "repo.analyze", { projectId: "not-a-uuid" });
    await runPending(db, handlers);
    const [job] = await db.select().from(jobs).where(eq(jobs.id, id));
    expect(job.status).toBe("pending");
    expect(job.attempts).toBe(1);
  });
});
