import { connection } from "next/server";
import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { handlers } from "@/lib/jobs/handlers";
import { runPending } from "@/lib/jobs/queue";

// Vercel cron은 GET으로 호출하고 `Authorization: Bearer ${CRON_SECRET}`을 붙인다.
export async function GET(req: Request): Promise<Response> {
  // cacheComponents: 요청 시점에만 실행되도록 보장한다(프리렌더/캐시 금지).
  await connection();
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const processed = await runPending(db, handlers);
  return Response.json({ processed });
}
