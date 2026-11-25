import { z } from "zod";
import type { Handler } from "./queue";
import type { JobKind } from "@/lib/db/schema";
import { analyzeRepo } from "@/lib/agents/repo-analyst";

const repoAnalyzePayload = z.object({ projectId: z.string().uuid() });

// 작업 종류별 핸들러 레지스트리. 이후 Task에서 채운다.
export const handlers: Partial<Record<JobKind, Handler>> = {
  "repo.analyze": async (payload, db) => {
    const { projectId } = repoAnalyzePayload.parse(payload);
    await analyzeRepo(db, projectId);
  },
};
