import { index, pgTable, primaryKey, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { user } from "./auth";
import { ticketEvents, tickets } from "./tickets";

export const ticketSubscriptions = pgTable(
  "ticket_subscriptions",
  {
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.ticketId, t.userId] })],
);

export const notifications = pgTable(
  "notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id")
      .notNull()
      .references(() => user.id, { onDelete: "cascade" }),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    eventId: uuid("event_id")
      .notNull()
      .references(() => ticketEvents.id, { onDelete: "cascade" }),
    /** 이벤트 type을 그대로 따른다 (submit, claim, close, …) */
    kind: text("kind").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("notifications_user_idx").on(t.userId, t.readAt, t.createdAt)],
);

/** 티켓 댓글. 본문은 마크다운. */
export const comments = pgTable(
  "comments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ticketId: uuid("ticket_id")
      .notNull()
      .references(() => tickets.id, { onDelete: "cascade" }),
    authorId: text("author_id")
      .notNull()
      .references(() => user.id),
    body: text("body").notNull(),
    createdAt: timestamp("created_at").defaultNow().notNull(),
  },
  (t) => [index("comments_ticket_idx").on(t.ticketId, t.createdAt)],
);

export type ThemePreference = "light" | "dark" | "system";

/** 사용자 화면 설정. accentOverride가 null이면 프로젝트 기본 강조색을 따른다. */
export const userPreferences = pgTable("user_preferences", {
  userId: text("user_id")
    .primaryKey()
    .references(() => user.id, { onDelete: "cascade" }),
  theme: text("theme").$type<ThemePreference>().notNull().default("system"),
  accentOverride: text("accent_override"),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});
