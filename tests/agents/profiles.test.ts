import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { agentProfileVersions } from "@/lib/db/schema";
import { MODEL_DEFAULTS, defaultModelFor } from "@/lib/ai/models";
import { ensureDefaultProfiles, getActiveProfile, saveProfileVersion } from "@/lib/agents/profiles";

let db: Db;
let close: () => Promise<void>;
let editorId: string;
let anthropicProject: string;
let geminiProject: string;

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const auth = createAuth(db);
  const editor = await signUp(auth, "lead@example.com", "리드");
  editorId = editor.id;
  anthropicProject = (await makeProject(db, auth, "prof-a", editorId)).project.id;
  geminiProject = (await makeProject(db, auth, "prof-g", editorId, { defaultProvider: "google" })).project.id;
});
afterAll(async () => {
  await close();
});

describe("에이전트 프로필 버전", () => {
  test("저장할 때마다 version 증가, 최신이 활성", async () => {
    await ensureDefaultProfiles(db, anthropicProject, editorId);
    const v1 = await getActiveProfile(db, anthropicProject, "lead");
    expect(v1.version).toBe(1);

    await saveProfileVersion(db, {
      projectId: anthropicProject,
      role: "lead",
      instructions: "새 지시사항",
      toolNames: ["getDomainDocs"],
      modelId: "anthropic:custom",
      maxSteps: 3,
      editorId,
    });
    const v2 = await getActiveProfile(db, anthropicProject, "lead");
    expect(v2).toMatchObject({
      version: 2,
      instructions: "새 지시사항",
      toolNames: ["getDomainDocs"],
      modelId: "anthropic:custom",
      maxSteps: 3,
    });
    expect(v2.versionId).not.toBe(v1.versionId);

    const rows = await db
      .select()
      .from(agentProfileVersions)
      .where(and(eq(agentProfileVersions.projectId, anthropicProject), eq(agentProfileVersions.role, "lead")));
    expect(rows).toHaveLength(2);
  });

  test("ensureDefaultProfiles는 5역할 v1을 만들고 다시 불러도 늘리지 않는다", async () => {
    await ensureDefaultProfiles(db, anthropicProject, editorId);
    const rows = await db.select().from(agentProfileVersions).where(eq(agentProfileVersions.projectId, anthropicProject));
    const roles = new Set(rows.map((r) => r.role));
    expect(roles).toEqual(new Set(["resolver", "lead", "recommender", "summarizer", "repo"]));
    expect(rows.filter((r) => r.role !== "lead")).toHaveLength(4);
    const resolver = await getActiveProfile(db, anthropicProject, "resolver");
    expect(resolver.toolNames).toEqual(["searchTickets", "getDomainDocs", "listRecentChanges"]);
    expect(resolver.maxSteps).toBe(6);
    expect(resolver.instructions).toContain("근거");
  });

  test("gemini 프로젝트의 기본 프로필은 google: 모델, resolver는 small", async () => {
    await ensureDefaultProfiles(db, geminiProject, editorId);
    const resolver = await getActiveProfile(db, geminiProject, "resolver");
    const lead = await getActiveProfile(db, geminiProject, "lead");
    expect(resolver.modelId).toBe(`google:${MODEL_DEFAULTS.google.small}`);
    expect(lead.modelId).toBe(`google:${MODEL_DEFAULTS.google.mid}`);
    expect(defaultModelFor("google", "summarizer")).toBe(`google:${MODEL_DEFAULTS.google.mid}`);
  });

  test("프로필이 없으면 getActiveProfile은 오류를 던진다", async () => {
    const auth = createAuth(db);
    const { project } = await makeProject(db, auth, "prof-empty", editorId);
    await expect(getActiveProfile(db, project.id, "lead")).rejects.toThrow();
  });
});
