import { and, count, eq, isNull } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { notifications } from "@/lib/db/schema";

/** 읽지 않은 알림 수. 상단 바 배지가 30초마다 가져간다. */
export async function countUnread(db: Db, userId: string): Promise<number> {
  const [row] = await db
    .select({ n: count() })
    .from(notifications)
    .where(and(eq(notifications.userId, userId), isNull(notifications.readAt)));
  return row?.n ?? 0;
}
