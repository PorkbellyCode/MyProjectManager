import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { createPgTestDb, pgAvailable } from "../helpers/pg";
import type { Db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { enqueue, runPending, type Handler } from "@/lib/jobs/queue";
import { GET } from "@/app/api/cron/jobs/route";

// connection()은 요청 스코프 밖에서 호출하면 던지므로 테스트에서는 no-op으로 대체한다.
vi.mock("next/server", () => ({ connection: async () => {} }));

const holder = vi.hoisted(() => ({ db: undefined as unknown }));
vi.mock("@/lib/db", () => ({ db: new Proxy({}, { get: (_t, p) => Reflect.get(holder.db as object, p) }) }));

async function getJob(db: Db, id: string) {
  const [row] = await db.select().from(jobs).where(eq(jobs.id, id));
  return row;
}

describe("작업 큐", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createTestDb());
  });
  afterAll(async () => close());
  beforeEach(async () => {
    await db.delete(jobs);
  });

  test("성공하면 done, 핸들러는 payload와 db를 받는다", async () => {
    const id = await enqueue(db, "ticket.summarize", { ticketId: "t1" });
    const seen: unknown[] = [];
    const n = await runPending(db, {
      "ticket.summarize": async (payload, d) => {
        seen.push(payload, d === db);
      },
    });
    expect(n).toBe(1);
    expect(seen).toEqual([{ ticketId: "t1" }, true]);
    const row = await getJob(db, id);
    expect(row.status).toBe("done");
    expect(row.attempts).toBe(0);
    expect(row.lastError).toBeNull();
  });

  test("실패하면 attempts+1, pending, runAfter = now + attempts*30초", async () => {
    const id = await enqueue(db, "repo.analyze", {});
    const handlers = { "repo.analyze": async () => { throw new Error("boom"); } };
    const before = Date.now();
    await runPending(db, handlers);
    const row = await getJob(db, id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("boom");
    const delay = row.runAfter.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(29_000);
    expect(delay).toBeLessThan(40_000);
    // runAfter가 미래이므로 바로 다시 집지 않는다
    expect(await runPending(db, handlers)).toBe(0);
  });

  test("3회 실패하면 failed + lastError", async () => {
    const id = await enqueue(db, "repo.analyze", {});
    const handlers = { "repo.analyze": async () => { throw new Error("boom"); } };
    for (let i = 1; i <= 3; i++) {
      await db.update(jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(jobs.id, id));
      await runPending(db, handlers);
      const row = await getJob(db, id);
      expect(row.attempts).toBe(i);
      if (i < 3) {
        expect(row.status).toBe("pending");
        const delay = row.runAfter.getTime() - Date.now();
        expect(delay).toBeGreaterThan((i * 30 - 2) * 1000);
        expect(delay).toBeLessThanOrEqual(i * 30 * 1000);
      }
    }
    const row = await getJob(db, id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("boom");
  });

  test("핸들러가 없는 kind는 failed + 'no handler: <kind>'", async () => {
    const id = await enqueue(db, "ticket.silentReview", {});
    expect(await runPending(db, {})).toBe(1);
    const row = await getJob(db, id);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("no handler: ticket.silentReview");
  });

  test("limit만큼만, 오래된 순으로 처리한다", async () => {
    const ids: string[] = [];
    for (let i = 0; i < 3; i++) {
      const id = await enqueue(db, "ticket.summarize", { i });
      // createdAt이 같은 값으로 겹치면 순서가 불안정하므로 명시적으로 벌려 둔다.
      await db.update(jobs).set({ createdAt: new Date(Date.now() - (3 - i) * 1000) }).where(eq(jobs.id, id));
      ids.push(id);
    }
    const order: number[] = [];
    const n = await runPending(
      db,
      { "ticket.summarize": async (p) => { order.push((p as { i: number }).i); } },
      2,
    );
    expect(n).toBe(2);
    expect(order).toEqual([0, 1]);
    expect((await getJob(db, ids[2])).status).toBe("pending");
  });

  test("5분 넘게 running인 작업은 실패 1회로 회수한다(R12)", async () => {
    const old = (min: number) => new Date(Date.now() - min * 60_000);
    const a = await enqueue(db, "repo.analyze", {});
    const b = await enqueue(db, "repo.analyze", {});
    const c = await enqueue(db, "repo.analyze", {});
    await db.update(jobs).set({ status: "running", updatedAt: old(6) }).where(eq(jobs.id, a));
    await db.update(jobs).set({ status: "running", attempts: 2, updatedAt: old(6) }).where(eq(jobs.id, b));
    await db.update(jobs).set({ status: "running", updatedAt: old(1) }).where(eq(jobs.id, c));
    const before = Date.now();
    expect(await runPending(db, {})).toBe(0);
    const ra = await getJob(db, a);
    expect(ra.status).toBe("pending");
    expect(ra.attempts).toBe(1);
    expect(ra.lastError).toBe("stale: running > 5m");
    const delay = ra.runAfter.getTime() - before;
    expect(delay).toBeGreaterThanOrEqual(29_000);
    expect(delay).toBeLessThan(40_000);
    const rb = await getJob(db, b);
    expect(rb.status).toBe("failed");
    expect(rb.attempts).toBe(3);
    expect(rb.lastError).toBe("stale: running > 5m");
    const rc = await getJob(db, c);
    expect(rc.status).toBe("running");
    expect(rc.attempts).toBe(0);
  });

  test("제한 시간을 넘긴 핸들러는 실패로 기록한다", async () => {
    const id = await enqueue(db, "repo.analyze", {});
    const n = await runPending(
      db,
      { "repo.analyze": () => new Promise<void>((r) => setTimeout(r, 500)) },
      5,
      { timeoutMs: 50 },
    );
    expect(n).toBe(1);
    const row = await getJob(db, id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("timeout: 0.05s");
  });

  test("배치에서 기다린 시간은 stale 판정에 들어가지 않는다(시작 직전 updatedAt 갱신)", async () => {
    const a = await enqueue(db, "ticket.summarize", { i: 0 });
    const b = await enqueue(db, "ticket.summarize", { i: 1 });
    await db.update(jobs).set({ createdAt: new Date(Date.now() - 2000) }).where(eq(jobs.id, a));
    await db.update(jobs).set({ createdAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, b));
    let bUpdatedAtDuringA: Date | undefined;
    let bStartUpdatedAt: Date | undefined;
    await runPending(db, {
      "ticket.summarize": async (p) => {
        if ((p as { i: number }).i === 0) {
          bUpdatedAtDuringA = (await getJob(db, b)).updatedAt;
          await new Promise((r) => setTimeout(r, 100));
        } else {
          bStartUpdatedAt = (await getJob(db, b)).updatedAt;
        }
      },
    });
    expect(bStartUpdatedAt!.getTime()).toBeGreaterThan(bUpdatedAtDuringA!.getTime());
  });

  test("기다리는 사이 회수된 배치 작업은 핸들러를 실행하지 않는다", async () => {
    const a = await enqueue(db, "ticket.summarize", { i: 0 });
    const b = await enqueue(db, "ticket.summarize", { i: 1 });
    await db.update(jobs).set({ createdAt: new Date(Date.now() - 2000) }).where(eq(jobs.id, a));
    await db.update(jobs).set({ createdAt: new Date(Date.now() - 1000) }).where(eq(jobs.id, b));
    const ran: number[] = [];
    await runPending(db, {
      "ticket.summarize": async (p) => {
        const i = (p as { i: number }).i;
        ran.push(i);
        if (i === 0) {
          // a가 도는 동안 b가 회수된 상황
          await db.update(jobs).set({ status: "pending", attempts: 1 }).where(eq(jobs.id, b));
        }
      },
    });
    expect(ran).toEqual([0]);
    const row = await getJob(db, b);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
  });

  test("회수된 작업을 늦게 끝낸 핸들러는 결과를 덮어쓰지 않는다", async () => {
    const id = await enqueue(db, "repo.analyze", {});
    await runPending(db, {
      "repo.analyze": async () => {
        // 실행 중에 stale로 회수된 상황: attempts+1, pending으로 되돌아감
        await db
          .update(jobs)
          .set({ status: "pending", attempts: 1, lastError: "stale: running > 5m" })
          .where(eq(jobs.id, id));
      },
    });
    const row = await getJob(db, id);
    expect(row.status).toBe("pending");
    expect(row.attempts).toBe(1);
    expect(row.lastError).toBe("stale: running > 5m");

    // 실패로 끝나는 늦은 핸들러도 마찬가지
    await db.update(jobs).set({ runAfter: new Date(Date.now() - 1000) }).where(eq(jobs.id, id));
    await runPending(db, {
      "repo.analyze": async () => {
        await db.update(jobs).set({ status: "failed", attempts: 3, lastError: "x" }).where(eq(jobs.id, id));
        throw new Error("late");
      },
    });
    const row2 = await getJob(db, id);
    expect(row2.status).toBe("failed");
    expect(row2.attempts).toBe(3);
    expect(row2.lastError).toBe("x");
  });

  test("핸들러는 claim 커밋 뒤에 실행된다(실행 중 상태가 보인다)", async () => {
    const id = await enqueue(db, "ticket.summarize", {});
    let during: string | undefined;
    await runPending(db, {
      "ticket.summarize": async () => {
        during = (await getJob(db, id)).status;
      },
    });
    expect(during).toBe("running");
  });
});

describe("/api/cron/jobs", () => {
  test("시크릿이 없거나 틀리면 401", async () => {
    const r1 = await GET(new Request("http://localhost/api/cron/jobs"));
    expect(r1.status).toBe(401);
    const r2 = await GET(
      new Request("http://localhost/api/cron/jobs", { headers: { authorization: "Bearer wrong" } }),
    );
    expect(r2.status).toBe(401);
  });

  test("올바른 시크릿이면 runPending을 돌리고 { processed }를 돌려준다", async () => {
    const t = await createTestDb();
    holder.db = t.db;
    await enqueue(t.db, "ticket.silentReview", {}); // 아직 등록된 핸들러가 없는 종류는 failed로 처리된다
    const res = await GET(
      new Request("http://localhost/api/cron/jobs", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    const [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("no handler: ticket.silentReview");
    await t.close();
  });
});

const hasPg = await pgAvailable();

describe.skipIf(!hasPg)("작업 큐: 진짜 Postgres에서의 SKIP LOCKED", () => {
  let db: Db;
  let close: () => Promise<void>;
  beforeAll(async () => {
    ({ db, close } = await createPgTestDb());
  });
  afterAll(async () => close());

  test("동시에 도는 두 러너는 같은 작업을 중복 실행하지 않는다", async () => {
    for (let i = 0; i < 10; i++) await enqueue(db, "ticket.summarize", { i });
    const ran: number[] = [];
    const handler: Handler = async (p) => {
      ran.push((p as { i: number }).i);
      await new Promise((r) => setTimeout(r, 20));
    };
    const handlers = { "ticket.summarize": handler };
    const results = await Promise.all([
      runPending(db, handlers, 10),
      runPending(db, handlers, 10),
      runPending(db, handlers, 10),
    ]);
    expect(results.reduce((a, b) => a + b, 0)).toBe(10);
    expect(ran).toHaveLength(10);
    expect(new Set(ran).size).toBe(10);
    const rows = await db.select().from(jobs);
    expect(rows.every((r) => r.status === "done")).toBe(true);
  });
});
