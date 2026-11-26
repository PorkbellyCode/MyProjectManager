import fs from "node:fs";
import path from "node:path";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import * as schema from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { createAuth } from "@/lib/auth";
import { ensureDefaultProfiles } from "@/lib/agents/profiles";
import { upsertGroup } from "@/lib/groups/service";
import { createDraft, getActorCtx, performAction } from "@/lib/tickets/service";
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
  /** 요청자(최현업). demoProject에만 속한다. */
  req: { id: string; email: string; name: string };
  /** AI 검토를 쓰는 데모 프로젝트(isDemo, anthropic). 리드: lead, 개발자: dev, 요청자: req. 그룹은 이름순으로 백엔드, 프론트엔드. */
  demoProject: { id: string; name: string };
  groups: { backend: { id: string; name: string }; frontend: { id: string; name: string } };
  /** demoProject에 이미 제출된(그룹 큐) 티켓. 중복 확인의 후보가 된다. */
  origin: { id: string; number: number; title: string };
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

  // 요청자 화면(Task 14): AI 검토를 쓰는 데모 프로젝트, 그룹 둘, 이미 제출된 티켓 하나.
  const req = await signUp(auth, "req@e2e.test", "최현업");
  const demo = await makeProject(db, auth, "e2e-demo", lead.id, { name: "Workwrap 데모", defaultProvider: "anthropic", isDemo: true });
  await addMember(auth, demo.orgId, dev.id, "developer");
  await addMember(auth, demo.orgId, req.id, "requester");
  await ensureDefaultProfiles(db, demo.project.id, lead.id);
  const backend = await upsertGroup(db, { projectId: demo.project.id, name: "백엔드", scopeDescription: "API, 요약 생성, 저장", repoTags: ["server"] });
  const frontend = await upsertGroup(db, { projectId: demo.project.id, name: "프론트엔드", scopeDescription: "화면, 입력, 표시", repoTags: ["web"] });
  const draft = await createDraft(db, {
    projectId: demo.project.id,
    authorId: lead.id,
    title: "오늘 요약에 같은 작업이 두 번 나와요",
    body: "하루 요약을 만들면 '로그인 버그 수정'이 '오늘 한 일'에 두 번 들어가 있어요.",
    category: "defect",
    urgency: "high",
  });
  // 작업 큐(after)를 거치지 않도록 서비스로 바로 제출한다.
  await performAction(db, {
    ticketId: draft.id,
    expectedVersion: draft.version,
    action: { type: "submit", target: { kind: "group", groupId: backend.id } },
    actor: await getActorCtx(db, demo.project.id, lead.id),
  });

  await pool.end();
  const seed: E2eSeed = {
    password: PASSWORD,
    lead: { id: lead.id, email: lead.email, name: lead.name },
    dev: { id: dev.id, email: dev.email, name: dev.name },
    claudeProject: { id: claude.project.id, name: claude.project.name },
    geminiProject: { id: gemini.project.id, name: gemini.project.name },
    req: { id: req.id, email: req.email, name: req.name },
    demoProject: { id: demo.project.id, name: demo.project.name },
    groups: { backend: { id: backend.id, name: backend.name }, frontend: { id: frontend.id, name: frontend.name } },
    origin: { id: draft.id, number: draft.number, title: draft.title },
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
