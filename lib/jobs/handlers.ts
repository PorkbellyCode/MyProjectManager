import { z } from "zod";
import type { Handler } from "./queue";
import type { JobKind } from "@/lib/db/schema";
import { analyzeRepo } from "@/lib/agents/repo-analyst";
import { runReviewStage } from "@/lib/review/pipeline";
import { runSilentReview } from "@/lib/review/silent";
import { summarizeTicket } from "@/lib/review/summary";

const repoAnalyzePayload = z.object({ projectId: z.string().uuid() });

const reviewStagePayload = z.object({
  ticketId: z.string().uuid(),
  stage: z.enum(["dedup", "resolve", "interview", "recommend"]),
  version: z.number().int(),
});

const summarizePayload = z.object({ ticketId: z.string().uuid(), version: z.number().int().optional() });
const silentPayload = z.object({ ticketId: z.string().uuid() });

// 작업 종류별 핸들러 레지스트리.
export const handlers: Partial<Record<JobKind, Handler>> = {
  "repo.analyze": async (payload, db) => {
    const { projectId } = repoAnalyzePayload.parse(payload);
    await analyzeRepo(db, projectId);
  },
  "ticket.reviewStage": async (payload, db) => {
    await runReviewStage(db, reviewStagePayload.parse(payload));
  },
  "ticket.summarize": async (payload, db) => {
    await summarizeTicket(db, summarizePayload.parse(payload).ticketId);
  },
  "ticket.silentReview": async (payload, db) => {
    await runSilentReview(db, silentPayload.parse(payload).ticketId);
  },
};
