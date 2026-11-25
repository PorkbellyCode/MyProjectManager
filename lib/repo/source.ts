import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import { decrypt } from "@/lib/crypto";
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

/** 지금은 GitHub 출처만 돌려준다. 'local-cli'는 타입에만 있다. */
export async function getRepoSource(db: Db, projectId: string): Promise<RepoSource> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("프로젝트를 찾을 수 없어요.");
  return createGitHubSource({
    repoUrl: project.repoUrl,
    token: project.githubTokenEnc ? decrypt(project.githubTokenEnc) : undefined,
  });
}
