import { index, integer, jsonb, pgTable, timestamp, text, uuid } from "drizzle-orm/pg-core";
import { aiJudgments } from "./ai";
import { type ReviewStage, tickets } from "./tickets";

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
