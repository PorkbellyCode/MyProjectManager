import { and, desc, eq } from "drizzle-orm";
import type { LanguageModel } from "ai";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { groups, repoSnapshots } from "@/lib/db/schema";
import { runRoleAgent } from "@/lib/ai/run-agent";
import { getActiveProfile } from "@/lib/agents/profiles";
import { getRepoSource, RepoSourceError, type RepoFacts, type RepoSource } from "@/lib/repo/source";

export const repoOverviewSchema = z.object({
  stack: z.array(z.string()),
  modules: z.array(z.object({ path: z.string(), summary: z.string(), groupId: z.string().nullable() })),
  screens: z.array(z.object({ path: z.string(), name: z.string(), groupId: z.string().nullable() })),
  apis: z.array(z.object({ path: z.string(), method: z.string().nullable(), groupId: z.string().nullable() })),
  domains: z.array(z.object({ name: z.string(), modulePaths: z.array(z.string()) })),
});
export type RepoOverview = z.infer<typeof repoOverviewSchema>;

export type RepoSnapshot = typeof repoSnapshots.$inferSelect;

export type AnalyzeDeps = {
  /** 테스트용 주입. 없으면 `getRepoSource`. */
  source?: RepoSource;
  /** 테스트용 주입. 없으면 프로필의 모델. */
  model?: LanguageModel;
  timeoutMs?: number;
};

export type AnalyzeResult = { snapshotId: string; status: "ok" | "failed" };

function errorText(err: unknown): string {
  if (err instanceof RepoSourceError) return `${err.code}: ${err.message}`;
  return err instanceof Error ? err.message : String(err);
}

/** 모델이 돌려준 groupId 중 이 프로젝트의 그룹이 아닌 것은 null로 고친다. */
export function sanitizeGroupIds(overview: RepoOverview, validIds: Set<string>): RepoOverview {
  const fix = (id: string | null) => (id !== null && validIds.has(id) ? id : null);
  return {
    ...overview,
    modules: overview.modules.map((m) => ({ ...m, groupId: fix(m.groupId) })),
    screens: overview.screens.map((s) => ({ ...s, groupId: fix(s.groupId) })),
    apis: overview.apis.map((a) => ({ ...a, groupId: fix(a.groupId) })),
  };
}

function buildPrompt(facts: RepoFacts, projectGroups: { id: string; name: string; scopeDescription: string }[]): string {
  const groupLines = projectGroups.length
    ? projectGroups.map((g) => `- id: ${g.id} / 이름: ${g.name} / 담당 범위: ${g.scopeDescription || "(설명 없음)"}`).join("\n")
    : "(그룹이 아직 없어요. 모든 groupId는 null로 둡니다.)";
  return [
    "## 그룹 목록 (groupId에는 아래 id만 쓰고, 맞는 그룹이 분명하지 않으면 null)",
    groupLines,
    "",
    "## 레포 정보",
    JSON.stringify(facts),
  ].join("\n");
}

async function insertSnapshot(db: Db, values: typeof repoSnapshots.$inferInsert): Promise<string> {
  const [row] = await db.insert(repoSnapshots).values(values).returning({ id: repoSnapshots.id });
  return row.id;
}

/**
 * 레포 정보를 가져와 개요를 분석하고 스냅샷을 남긴다.
 * - 출처 오류 not_found/unauthorized: 영구 오류. failed 스냅샷을 남기고 정상 반환(재시도해도 같다).
 * - 출처 오류 rate_limited/unknown: failed 스냅샷을 남기고 다시 던진다(작업 큐가 재시도).
 * - AI 실패(시간 초과, 스키마 불일치 등): failed 스냅샷만 남기고 정상 반환. 자동 재시도로 토큰을 반복해서 쓰지 않고 수동 재분석에 맡긴다.
 */
export async function analyzeRepo(db: Db, projectId: string, deps: AnalyzeDeps = {}): Promise<AnalyzeResult> {
  let facts: RepoFacts;
  try {
    const source = deps.source ?? (await getRepoSource(db, projectId));
    facts = await source.fetchFacts();
  } catch (err) {
    if (!(err instanceof RepoSourceError)) throw err;
    const snapshotId = await insertSnapshot(db, {
      projectId,
      facts: null,
      overview: null,
      status: "failed",
      error: errorText(err),
    });
    if (err.code === "rate_limited" || err.code === "unknown") throw err;
    return { snapshotId, status: "failed" };
  }

  try {
    const projectGroups = await db
      .select({ id: groups.id, name: groups.name, scopeDescription: groups.scopeDescription })
      .from(groups)
      .where(eq(groups.projectId, projectId));
    const profile = await getActiveProfile(db, projectId, "repo");
    const { output } = await runRoleAgent({
      profile,
      system: profile.instructions,
      prompt: buildPrompt(facts, projectGroups),
      tools: {},
      schema: repoOverviewSchema,
      telemetry: { projectId, ticketId: null },
      timeoutMs: deps.timeoutMs,
      model: deps.model,
    });
    const overview = sanitizeGroupIds(output, new Set(projectGroups.map((g) => g.id)));
    const snapshotId = await insertSnapshot(db, { projectId, facts, overview, status: "ok", error: null });
    return { snapshotId, status: "ok" };
  } catch (err) {
    const snapshotId = await insertSnapshot(db, {
      projectId,
      facts,
      overview: null,
      status: "failed",
      error: errorText(err),
    });
    return { snapshotId, status: "failed" };
  }
}

export async function getLatestSnapshot(
  db: Db,
  projectId: string,
  opts: { status?: "ok" } = {},
): Promise<RepoSnapshot | null> {
  const [row] = await db
    .select()
    .from(repoSnapshots)
    .where(
      opts.status
        ? and(eq(repoSnapshots.projectId, projectId), eq(repoSnapshots.status, opts.status))
        : eq(repoSnapshots.projectId, projectId),
    )
    .orderBy(desc(repoSnapshots.createdAt), desc(repoSnapshots.id))
    .limit(1);
  return row ?? null;
}

export type OverviewTagPatch = {
  /** path → groupId(null이면 태그 해제) */
  modules?: Record<string, string | null>;
  screens?: Record<string, string | null>;
  apis?: Record<string, string | null>;
};

/** 리드가 그룹 태그를 고친다. 이 프로젝트의 그룹이 아닌 id는 거부한다. */
export async function updateOverviewTags(db: Db, snapshotId: string, patch: OverviewTagPatch): Promise<RepoSnapshot> {
  const [snap] = await db.select().from(repoSnapshots).where(eq(repoSnapshots.id, snapshotId));
  if (!snap || !snap.overview) throw new Error("수정할 수 있는 개요가 없어요.");
  const valid = new Set(
    (await db.select({ id: groups.id }).from(groups).where(eq(groups.projectId, snap.projectId))).map((g) => g.id),
  );
  for (const map of [patch.modules, patch.screens, patch.apis]) {
    for (const id of Object.values(map ?? {})) {
      if (id !== null && !valid.has(id)) throw new Error("이 프로젝트에 없는 그룹이에요.");
    }
  }
  const apply = <T extends { path: string; groupId: string | null }>(items: T[], map?: Record<string, string | null>): T[] =>
    map ? items.map((i) => (Object.hasOwn(map, i.path) ? { ...i, groupId: map[i.path] } : i)) : items;
  const overview: RepoOverview = {
    ...snap.overview,
    modules: apply(snap.overview.modules, patch.modules),
    screens: apply(snap.overview.screens, patch.screens),
    apis: apply(snap.overview.apis, patch.apis),
  };
  const [row] = await db
    .update(repoSnapshots)
    .set({ overview })
    .where(and(eq(repoSnapshots.id, snapshotId), eq(repoSnapshots.status, "ok")))
    .returning();
  return row;
}
