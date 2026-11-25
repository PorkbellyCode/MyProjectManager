import { z } from "zod";
import type { Handler } from "./queue";
import type { JobKind } from "@/lib/db/schema";
import { analyzeRepo } from "@/lib/agents/repo-analyst";
import { runReviewStage } from "@/lib/review/pipeline";

const repoAnalyzePayload = z.object({ projectId: z.string().uuid() });

const reviewStagePayload = z.object({
  ticketId: z.string().uuid(),
  stage: z.enum(["dedup", "resolve", "interview", "recommend"]),
  version: z.number().int(),
});

// 작업 종류별 핸들러 레지스트리. 이후 Task에서 채운다.
export const handlers: Partial<Record<JobKind, Handler>> = {
  "repo.analyze": async (payload, db) => {
    const { projectId } = repoAnalyzePayload.parse(payload);
    await analyzeRepo(db, projectId);
  },
  "ticket.reviewStage": async (payload, db) => {
    await runReviewStage(db, reviewStagePayload.parse(payload));
  },
};
