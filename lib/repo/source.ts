import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
import { SEED_PINNED_COMMIT_FULL } from "@/lib/demo/seed-data";
import { env } from "@/lib/env";
import { createGitHubSource } from "./sources/github";

export type RepoFacts = {
  sourceKind: "github" | "local-cli";
  repoLabel: string;
  defaultBranch: string;
  /** 깊이 3 이하, 최대 2000개 */
  paths: string[];
  /** package.json, pom.xml, build.gradle, requirements.txt 중 있는 것. 각 20KB 이하 */
  manifests: Record<string, string>;
  readme: string | null;
  /** 최대 50개 */
  commits: { sha: string; message: string; date: string; url: string | null }[];
  /** 최대 30개 */
  pulls: { number: number; title: string; state: string; mergedAt: string | null; url: string | null }[];
  /** 트리 응답이 잘렸거나 상한에 걸려 일부만 담았으면 true */
  truncated: boolean;
};

export interface RepoSource {
  fetchFacts(): Promise<RepoFacts>;
}

export type RepoSourceErrorCode = "not_found" | "unauthorized" | "rate_limited" | "unknown";

export class RepoSourceError extends Error {
  constructor(
    public readonly code: RepoSourceErrorCode,
    message?: string,
  ) {
    super(message ?? code);
    this.name = "RepoSourceError";
  }
}

/** MPM_FAKE_AI=1(E2E)에서 네트워크 없이 쓰는 고정 레포 정보. */
export function createFakeRepoSource(repoUrl: string): RepoSource {
  return {
    fetchFacts: async () => ({
      sourceKind: "github",
      repoLabel: repoUrl.replace(/^https:\/\/github\.com\//, ""),
      defaultBranch: "main",
      paths: ["app/summary/page.tsx", "app/api/summary/route.ts", "lib/summary/build.ts", "package.json"],
      manifests: { "package.json": '{"dependencies":{"next":"16","react":"19"}}' },
      readme: "# 예시 레포",
      // 시연 시드의 해소 근거(커밋 a69abef)가 근거 정규화를 통과하도록 최신 성공 스냅샷에 이 커밋을 둔다.
      commits: [
        {
          sha: SEED_PINNED_COMMIT_FULL,
          message: "메모 '이어가기'를 '고정하기'(pinned)로 변경",
          date: "2026-11-20T00:00:00.000Z",
          url: `${repoUrl.replace(/\/$/, "")}/commit/${SEED_PINNED_COMMIT_FULL}`,
        },
      ],
      pulls: [],
      truncated: false,
    }),
  };
}

/** 지금은 GitHub 출처만 돌려준다('local-cli'는 타입에만 있다). MPM_FAKE_AI=1이면 고정 값. */
export async function getRepoSource(db: Db, projectId: string): Promise<RepoSource> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("프로젝트를 찾을 수 없어요.");
  if (env.MPM_FAKE_AI === "1") return createFakeRepoSource(project.repoUrl);
  return createGitHubSource({
    repoUrl: project.repoUrl,
    token: project.githubTokenEnc ? decrypt(project.githubTokenEnc) : undefined,
  });
}
