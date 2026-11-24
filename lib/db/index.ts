import { drizzle as drizzleNode } from "drizzle-orm/node-postgres";
import { drizzle as drizzleNeon } from "drizzle-orm/neon-serverless";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { Pool as PgPool } from "pg";
import { Pool as NeonPool, neonConfig } from "@neondatabase/serverless";
import ws from "ws";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type Schema = typeof schema;

/**
 * 실제 드라이버(node-postgres, neon-serverless)와 PGlite 테스트 DB가
 * 모두 만족하는 공통 타입. 서비스 함수는 `db: Db`를 받는다.
 */
export type Db = PgDatabase<PgQueryResultHKT, Schema>;

export function isLocalUrl(url: string): boolean {
  const host = new URL(url).hostname;
  return host === "localhost" || host === "127.0.0.1";
}

function createDb(): Db {
  const url = env.DATABASE_URL;
  if (isLocalUrl(url)) {
    return drizzleNode(new PgPool({ connectionString: url }), { schema });
  }
  // neon-http는 대화형 트랜잭션이 없으므로 쓰지 않는다. WebSocket Pool을 쓴다.
  neonConfig.webSocketConstructor = ws;
  return drizzleNeon(new NeonPool({ connectionString: url }), { schema });
}

// import 시점이 아니라 처음 쓸 때 연결 객체를 만든다(빌드/테스트에서 연결 부작용 방지).
let cached: Db | undefined;
export const db: Db = new Proxy({} as Db, {
  get(_t, prop) {
    cached ??= createDb();
    const value = Reflect.get(cached, prop, cached);
    return typeof value === "function" ? value.bind(cached) : value;
  },
});
