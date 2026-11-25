import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { addMember, makeProject, signUp } from "../../tests/helpers/world";
import { E2E_DATABASE_URL, E2E_DB_NAME, PG_ADMIN_URL } from "./env";

export const SEED_FILE = path.resolve(__dirname, "../.seed.json");
export const PASSWORD = "password-1234";

export type E2eSeed = {
  password: string;
  lead: { id: string; email: string; name: string };
  dev: { id: string; email: string; name: string };
  /** 기본 제공자 anthropic (리드: lead, 개발자: dev) */
  claudeProject: { id: string; name: string };
  /** 기본 제공자 google (리드: lead) */
  geminiProject: { id: string; name: string };
};

/** 새 E2E 데이터베이스를 만들고 마이그레이션한 뒤, 서비스/Better Auth API로 사용자와 프로젝트를 만든다(R4). */
export async function seedE2e(): Promise<E2eSeed> {
  const admin = new Pool({ connectionString: PG_ADMIN_URL });
  await admin.query(`drop database if exists ${E2E_DB_NAME} with (force)`);
  await admin.query(`create database ${E2E_DB_NAME}`);
  await admin.end();

  const pool = new Pool({ connectionString: E2E_DATABASE_URL, max: 4 });
  const db = drizzle(pool, { schema }) as unknown as Db;
  await migrate(drizzle(pool, { schema }), { migrationsFolder: path.resolve(__dirname, "../../drizzle") });

  const auth = createAuth(db);
  const lead = await signUp(auth, "lead@e2e.test", "이리드");
  const dev = await signUp(auth, "dev@e2e.test", "박개발");

  const claude = await makeProject(db, auth, "e2e-claude", lead.id, { name: "Workwrap", defaultProvider: "anthropic" });
  await addMember(auth, claude.orgId, dev.id, "developer");
  const gemini = await makeProject(db, auth, "e2e-gemini", lead.id, { name: "Gemini 팀", defaultProvider: "google" });

  await pool.end();
  const seed: E2eSeed = {
    password: PASSWORD,
    lead: { id: lead.id, email: lead.email, name: lead.name },
    dev: { id: dev.id, email: dev.email, name: dev.name },
    claudeProject: { id: claude.project.id, name: claude.project.name },
    geminiProject: { id: gemini.project.id, name: gemini.project.name },
  };
  fs.writeFileSync(SEED_FILE, JSON.stringify(seed, null, 2));
  return seed;
}

export function readSeed(): E2eSeed {
  return JSON.parse(fs.readFileSync(SEED_FILE, "utf8")) as E2eSeed;
}

/** 테스트 사이에 사용자 설정을 비운다. */
export async function resetPreferences(): Promise<void> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL });
  await pool.query("delete from user_preferences");
  await pool.end();
}
