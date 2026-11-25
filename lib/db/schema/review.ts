import { index, integer, jsonb, pgTable, primaryKey, timestamp, text, uuid } from "drizzle-orm/pg-core";
import type { RequiredField } from "@/lib/agents/interview";
import { aiJudgments } from "./ai";
import { user } from "./auth";
import { projects } from "./projects";
import { type Category, type ReviewStage, tickets } from "./tickets";

export type ReviewTurnKind = "duplicate_candidates" | "resolution" | "questions" | "ready" | "failed";

/** 검토 단계마다 요청자에게 보여 주는 카드(턴)와 그 응답. */
export const ticketReviewTurns = pgTable(
  "ticket_review_turns",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    stage: text("stage").$type<ReviewStage>().notNull(),
    round: integer("round"),
    kind: text("kind").$type<ReviewTurnKind>().notNull(),
    payload: jsonb("payload").$type<unknown>().notNull(),
    response: jsonb("response").$type<unknown>(),
    judgmentId: uuid("judgment_id").references(() => aiJudgments.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    respondedAt: timestamp("responded_at"),
  },
  (t) => [index("ticket_review_turns_ticket_idx").on(t.ticketId, t.createdAt)],
);

/** 프로젝트별 필요 정보 목록(관리자가 고친 값). 행이 없으면 코드의 기본값(`DEFAULT_REQUIRED_FIELDS`)을 쓴다. */
export const requiredFields = pgTable(
  "required_fields",
  {
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    category: text("category").$type<Category>().notNull(),
    items: jsonb("items").$type<RequiredField[]>().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [primaryKey({ columns: [t.projectId, t.category] })],
);

export type SummaryOrigin = "interview" | "original_only";

/** 제출 시점의 정리본. 마크다운이 본문이고, `data`는 `SummaryResult`(+ 필드 정의)다. 원문은 tickets에 그대로 있다. */
export const ticketSummaries = pgTable("ticket_summaries", {
  ticketId: uuid("ticket_id")
    .primaryKey()
    .references(() => tickets.id, { onDelete: "cascade" }),
  markdown: text("markdown").notNull(),
  data: jsonb("data").$type<unknown>().notNull(),
  generatedFrom: text("generated_from").$type<SummaryOrigin>().notNull(),
  editedBy: text("edited_by").references(() => user.id, { onDelete: "set null" }),
  editedAt: timestamp("edited_at"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
