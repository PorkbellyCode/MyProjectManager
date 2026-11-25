import { after } from "next/server";
import { and, asc, eq, lte, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { jobs, type JobKind } from "@/lib/db/schema";

export type Handler = (payload: unknown, db: Db) => Promise<void>;
export type Handlers = Partial<Record<JobKind, Handler>>;

export const MAX_ATTEMPTS = 3;
const BACKOFF_MS = 30_000;
const STALE_MS = 5 * 60_000;

/** 5분 넘게 running인 작업(프로세스 중단/서버리스 시간 초과)을 실패 1회로 되돌린다. */
async function reclaimStale(db: Db): Promise<void> {
  await db
    .update(jobs)
    .set({
      attempts: sql`${jobs.attempts} + 1`,
      lastError: "stale: running > 5m",
      status: sql`case when ${jobs.attempts} + 1 < ${MAX_ATTEMPTS} then 'pending' else 'failed' end`,
      runAfter: sql`case when ${jobs.attempts} + 1 < ${MAX_ATTEMPTS} then now() + (${jobs.attempts} + 1) * interval '30 seconds' else ${jobs.runAfter} end`,
      updatedAt: sql`now()`,
    })
    .where(and(eq(jobs.status, "running"), lte(jobs.updatedAt, sql`now() - ${STALE_MS / 1000} * interval '1 second'`)));
}

export async function enqueue(db: Db, kind: JobKind, payload: unknown): Promise<string> {
  const [row] = await db.insert(jobs).values({ kind, payload }).returning({ id: jobs.id });
  return row.id;
}

/**
 * 실행할 작업을 `FOR UPDATE SKIP LOCKED`로 집어 `running`으로 표시하고 커밋한 뒤,
 * 트랜잭션 밖에서 핸들러를 실행한다. 처리한 작업 수를 돌려준다.
 */
export async function runPending(db: Db, handlers: Handlers, limit = 5): Promise<number> {
  await reclaimStale(db);
  const claimed = await db.transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(jobs)
      .where(and(eq(jobs.status, "pending"), lte(jobs.runAfter, sql`now()`)))
      .orderBy(asc(jobs.createdAt), asc(jobs.id))
      .limit(limit)
      .for("update", { skipLocked: true });
    for (const row of rows) {
      await tx.update(jobs).set({ status: "running", updatedAt: new Date() }).where(eq(jobs.id, row.id));
    }
    return rows;
  });

  for (const job of claimed) {
    const handler = handlers[job.kind];
    if (!handler) {
      await db
        .update(jobs)
        .set({ status: "failed", lastError: `no handler: ${job.kind}`, updatedAt: new Date() })
        .where(eq(jobs.id, job.id));
      continue;
    }
    try {
      await handler(job.payload, db);
      await db.update(jobs).set({ status: "done", updatedAt: new Date() }).where(eq(jobs.id, job.id));
    } catch (e) {
      const attempts = job.attempts + 1;
      const message = e instanceof Error ? e.message : String(e);
      await db
        .update(jobs)
        .set(
          attempts < MAX_ATTEMPTS
            ? {
                status: "pending",
                attempts,
                lastError: message,
                runAfter: new Date(Date.now() + attempts * BACKOFF_MS),
                updatedAt: new Date(),
              }
            : { status: "failed", attempts, lastError: message, updatedAt: new Date() },
        )
        .where(eq(jobs.id, job.id));
    }
  }
  return claimed.length;
}

/** 응답이 끝난 뒤 작업 큐를 한 번 돌린다. 크론이 못 미친 부분을 즉시 처리하는 용도. */
export function kickJobs(): void {
  after(async () => {
    const [{ db }, { handlers }] = await Promise.all([import("@/lib/db"), import("./handlers")]);
    await runPending(db, handlers);
  });
}
