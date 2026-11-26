import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { countUnread } from "@/lib/notifications/queries";

// 상단 바 알림 배지가 30초마다 호출한다.
export async function GET(): Promise<Response> {
  await connection();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized" }, { status: 401 });
  return Response.json({ count: await countUnread(db, user.id) }, { headers: { "Cache-Control": "no-store" } });
}
