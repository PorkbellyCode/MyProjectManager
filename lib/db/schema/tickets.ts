import { sql } from "drizzle-orm";
import {
  type AnyPgColumn,
  boolean,
  customType,
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
import { groups, projects } from "./projects";

export type TicketStatus =
  | "draft"
  | "ai_reviewing"
  | "awaiting_requester"
  | "withdrawn_ai_resolved"
  | "queued"
  | "assigned"
  | "in_progress"
  | "on_hold"
  | "resolved"
  | "closed";
export type Urgency = "low" | "normal" | "high" | "urgent";
export type Category = "defect" | "improvement" | "feature" | "inquiry";
export type ReviewStage = "dedup" | "resolve" | "interview" | "recommend";
export type WithdrawKind = "joined_duplicate" | "already_resolved" | "expected_behavior";
export type CloseReason =
  | "resolved_confirmed"
  | "wont_do"
  | "duplicate"
  | "requester_withdrawn"
  | "other";
export type ActorKind = "user" | "ai" | "system";

const tsvector = customType<{ data: string }>({
  dataType() {
    return "tsvector";
  },
});

export const tickets = pgTable(
  "tickets",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    projectId: uuid("project_id")
      .notNull()
      .references(() => projects.id, { onDelete: "cascade" }),
    number: integer("number").notNull(),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    title: text("title").notNull(),
    /** 마크다운 */
    body: text("body").notNull().default(""),
    category: text("category").$type<Category>().notNull(),
    urgency: text("urgency").$type<Urgency>().notNull().default("normal"),
    targetUserId: text("target_user_id").references(() => user.id, { onDelete: "set null" }),
    targetGroupId: uuid("target_group_id").references(() => groups.id, { onDelete: "set null" }),
    assigneeId: text("assignee_id").references(() => user.id, { onDelete: "set null" }),
    status: text("status").$type<TicketStatus>().notNull().default("draft"),
    reviewStage: text("review_stage").$type<ReviewStage>(),
    interviewRound: integer("interview_round").notNull().default(0),
    withdrawKind: text("withdraw_kind").$type<WithdrawKind>(),
    closeReason: text("close_reason").$type<CloseReason>(),
    closeNote: text("close_note"),
    duplicateOfId: uuid("duplicate_of_id").references((): AnyPgColumn => tickets.id, {
      onDelete: "set null",
    }),
    aiAvailable: boolean("ai_available").notNull().default(false),
    /** 낙관적 동시성 제어용 */
    version: integer("version").notNull().default(0),
    searchVector: tsvector("search_vector").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    ),
    createdAt: timestamp("created_at").defaultNow().notNull(),
    updatedAt: timestamp("updated_at").defaultNow().notNull(),
  },
  (t) => [
    unique("tickets_project_id_number_unique").on(t.projectId, t.number),
    index("tickets_project_status_idx").on(t.projectId, t.status),
    index("tickets_search_idx").using("gin", t.searchVector),
  ],
);

export const ticketEvents = pgTable(
  "ticket_events",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    actorId: text("actor_id").references(() => user.id, { onDelete: "set null" }),
    actorKind: text("actor_kind").$type<ActorKind>().notNull(),
    type: text("type").notNull(),
    from: jsonb("from"),
    to: jsonb("to"),
    reason: text("reason"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("ticket_events_ticket_idx").on(t.ticketId, t.createdAt)],
);

export const ticketAttachments = pgTable("ticket_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  ticketId: uuid("ticket_id")
    .notNull()
    .references(() => tickets.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  name: text("name").notNull(),
  size: integer("size").notNull(),
  contentType: text("content_type").notNull(),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
