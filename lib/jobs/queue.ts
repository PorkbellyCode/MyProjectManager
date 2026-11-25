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

export const HANDLER_TIMEOUT_MS = 120_000;

function withTimeout(run: () => Promise<void>, ms: number): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout: ${ms / 1000}s`)), ms);
  });
  return Promise.race([run(), timeout]).finally(() => clearTimeout(timer));
}

/**
 * 실행할 작업을 `FOR UPDATE SKIP LOCKED`로 집어 `running`으로 표시하고 커밋한 뒤,
 * 트랜잭션 밖에서 핸들러를 실행한다(핸들러당 제한 시간 있음). 처리한 작업 수를 돌려준다.
 * 최종 상태 갱신은 `running` + claim 시점의 attempts일 때만 적용한다(그 사이 회수됐으면 건드리지 않는다).
 */
export async function runPending(
  db: Db,
  handlers: Handlers,
  limit = 5,
  opts: { timeoutMs?: number } = {},
): Promise<number> {
  const timeoutMs = opts.timeoutMs ?? HANDLER_TIMEOUT_MS;
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
      await tx.update(jobs).set({ status: "running", updatedAt: sql`now()` }).where(eq(jobs.id, row.id));
    }
    return rows;
  });

  // claim 시점의 상태와 같을 때만 최종 갱신한다. 0행이면 이미 회수·재실행된 작업이므로 아무것도 하지 않는다.
  const stillMine = (job: (typeof claimed)[number]) =>
    and(eq(jobs.id, job.id), eq(jobs.status, "running"), eq(jobs.attempts, job.attempts));

  for (const job of claimed) {
    const handler = handlers[job.kind];
    if (!handler) {
      await db
        .update(jobs)
        .set({ status: "failed", lastError: `no handler: ${job.kind}`, updatedAt: sql`now()` })
        .where(stillMine(job));
      continue;
    }
    // 배치 안에서 기다린 시간이 stale 판정에 들어가지 않도록 시작 직전에 updatedAt을 갱신한다.
    // 0행이면 기다리는 사이 다른 러너가 회수·재실행한 작업이므로 핸들러를 실행하지 않는다.
    const touched = await db
      .update(jobs)
      .set({ updatedAt: sql`now()` })
      .where(stillMine(job))
      .returning({ id: jobs.id });
    if (touched.length === 0) continue;
    let error: string | undefined;
    try {
      await withTimeout(() => handler(job.payload, db), timeoutMs);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    if (error === undefined) {
      await db.update(jobs).set({ status: "done", updatedAt: sql`now()` }).where(stillMine(job));
      continue;
    }
    const attempts = job.attempts + 1;
    await db
      .update(jobs)
      .set(
        attempts < MAX_ATTEMPTS
          ? {
              status: "pending",
              attempts,
              lastError: error,
              runAfter: sql`now() + ${attempts * BACKOFF_MS / 1000} * interval '1 second'`,
              updatedAt: sql`now()`,
            }
          : { status: "failed", attempts, lastError: error, updatedAt: sql`now()` },
      )
      .where(stillMine(job));
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
