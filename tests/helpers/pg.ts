import { randomBytes } from "node:crypto";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export const TEST_PG_URL = process.env.TEST_PG_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";

/** 진짜 Postgres(여러 연결)에 접속할 수 있는지. */
export async function pgAvailable(): Promise<boolean> {
  const pool = new Pool({ connectionString: TEST_PG_URL, connectionTimeoutMillis: 1500 });
  try {
    await pool.query("select 1");
    return true;
  } catch {
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

/** 임시 데이터베이스를 만들어 마이그레이션한 진짜 Postgres 테스트 DB. 연결 풀이라 트랜잭션이 실제로 동시에 돈다. */
export async function createPgTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const name = `mpm_test_${randomBytes(4).toString("hex")}`;
  const admin = new Pool({ connectionString: TEST_PG_URL });
  await admin.query(`create database ${name}`);
  const url = new URL(TEST_PG_URL);
  url.pathname = `/${name}`;
  const pool = new Pool({ connectionString: url.toString(), max: 8 });
  // 종료 시 drop database ... with (force)가 유휴 연결을 끊으면 풀이 error를 낸다. 처리하지 않으면 테스트 런이 오류로 표시된다.
  pool.on("error", () => {});
  const db = drizzle(pool, { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return {
    db,
    close: async () => {
      await pool.end();
      await admin.query(`drop database ${name} with (force)`);
      await admin.end();
    },
  };
}
