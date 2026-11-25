import {
  type AnyPgColumn,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  unique,
  uuid,
} from "drizzle-orm/pg-core";
import { user } from "./auth";
import { projects } from "./projects";
import { type ReviewStage, tickets } from "./tickets";

export type AgentRole = "resolver" | "lead" | "recommender" | "summarizer" | "repo";
export type JudgmentStatus = "ok" | "failed" | "discarded";

/** 프로젝트별 시스템 에이전트 프로필. 저장할 때마다 새 행(버전)이 생기고 최신이 활성이다. */
export const agentProfileVersions = pgTable(
  "agent_profile_versions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<AgentRole>().notNull(),
    version: integer("version").notNull(),
    /** 마크다운 */
    instructions: text("instructions").notNull(),
    toolNames: text("tool_names").array().notNull().default([]),
    /** "<provider>:<model>" */
    modelId: text("model_id").notNull(),
    maxSteps: integer("max_steps").notNull().default(6),
    createdBy: text("created_by")
      .notNull()
      .references(() => user.id),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [unique("agent_profile_versions_project_role_version_unique").on(t.projectId, t.role, t.version)],
);

/** 모든 AI 판단 기록. 어떤 프로필 버전으로, 어떤 근거로, 토큰을 얼마나 썼는지 남긴다. */
export const aiJudgments = pgTable(
  "ai_judgments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id").references(() => tickets.id, { onDelete: "cascade" }),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    role: text("role").$type<AgentRole>().notNull(),
    stage: text("stage").$type<ReviewStage>(),
    round: integer("round"),
    profileVersionId: uuid("profile_version_id")
      .notNull()
      .references(() => agentProfileVersions.id),
    input: jsonb("input").$type<unknown>().notNull(),
    output: jsonb("output").$type<unknown>().notNull(),
    normalized: jsonb("normalized").$type<unknown>(),
    evidence: jsonb("evidence").$type<unknown>().notNull(),
    steps: jsonb("steps").$type<unknown>().notNull(),
    status: text("status").$type<JudgmentStatus>().notNull(),
    error: text("error"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    traceId: text("trace_id"),
    parentJudgmentId: uuid("parent_judgment_id").references((): AnyPgColumn => aiJudgments.id, {
      onDelete: "set null",
    }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ai_judgments_ticket_idx").on(t.ticketId, t.createdAt)],
);
