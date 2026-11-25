import { env } from "@/lib/env";
import { db } from "@/lib/db";
import { handlers } from "@/lib/jobs/handlers";
import { runPending } from "@/lib/jobs/queue";

export const dynamic = "force-dynamic";

// Vercel cron은 GET으로 호출하고 `Authorization: Bearer ${CRON_SECRET}`을 붙인다.
export async function GET(req: Request): Promise<Response> {
  if (req.headers.get("authorization") !== `Bearer ${env.CRON_SECRET}`) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const processed = await runPending(db, handlers);
  return Response.json({ processed });
}
