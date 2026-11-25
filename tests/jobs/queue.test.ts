import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vitest";
import { eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { createPgTestDb, pgAvailable } from "../helpers/pg";
import type { Db } from "@/lib/db";
import { jobs } from "@/lib/db/schema";
import { enqueue, runPending, type Handler } from "@/lib/jobs/queue";
import { GET } from "@/app/api/cron/jobs/route";

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
    for (let i = 0; i < 3; i++) ids.push(await enqueue(db, "ticket.summarize", { i }));
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
    await enqueue(t.db, "repo.analyze", {}); // 핸들러 레지스트리가 비어 있으므로 failed로 처리된다
    const res = await GET(
      new Request("http://localhost/api/cron/jobs", {
        headers: { authorization: `Bearer ${process.env.CRON_SECRET}` },
      }),
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ processed: 1 });
    const [row] = await t.db.select().from(jobs);
    expect(row.status).toBe("failed");
    expect(row.lastError).toBe("no handler: repo.analyze");
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
