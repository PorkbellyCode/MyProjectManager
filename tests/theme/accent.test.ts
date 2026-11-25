import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "../helpers/db";
import { makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { projects, userPreferences } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  accentPair,
  contrastRatio,
  getProjectAccent,
  onAccent,
  pickAccent,
  providerAiTokens,
  providerPalette,
} from "@/lib/theme/accent";
import { getPreferences, savePreferences } from "@/lib/preferences/service";

describe("providerPalette", () => {
  test("디자인 규칙의 제공자별 값", () => {
    expect(providerPalette("anthropic")).toEqual({ accent: "#C2410C", accentDark: "#EF7D3C", tint: "#FBEFE9", ring: "#F1CDBD" });
    expect(providerPalette("openai")).toEqual({ accent: "#0F766E", accentDark: "#2DD4BF", tint: "#E7F6F0", ring: "#B5E2D2" });
    expect(providerPalette("google")).toEqual({ accent: "#1D4ED8", accentDark: "#6FA3FF", tint: "#EEF3FE", ring: "#C7D6FB" });
  });

  test("돌려준 객체를 바꿔도 원본은 그대로다", () => {
    providerPalette("google").accent = "#000000";
    expect(providerPalette("google").accent).toBe("#1D4ED8");
  });

  test("AI 표시 토큰의 라이트/다크 값이 palette의 tint·ring과 일치한다", () => {
    for (const p of ["anthropic", "openai", "google"] as const) {
      expect(providerAiTokens(p).light.tint).toBe(providerPalette(p).tint);
      expect(providerAiTokens(p).light.ring).toBe(providerPalette(p).ring);
    }
    expect(providerAiTokens("openai").dark).toEqual({ tint: "#0F2620", ring: "#1F5546", text: "#62D6B3" });
  });
});

describe("accent helpers", () => {
  test("pickAccent: 사용자 → 프로젝트 → 제공자 순서", () => {
    expect(pickAccent({ override: "#111111", projectDefault: "#222222", provider: "google" })).toBe("#111111");
    expect(pickAccent({ override: null, projectDefault: "#222222", provider: "google" })).toBe("#222222");
    expect(pickAccent({ override: null, projectDefault: null, provider: "google" })).toBe("#1D4ED8");
  });

  test("프리셋은 다크 짝을 쓰고 직접 고른 색은 그대로 쓴다", () => {
    expect(accentPair("#0f766e")).toEqual({ light: "#0F766E", dark: "#2DD4BF" });
    expect(accentPair("#7C3AED")).toEqual({ light: "#7C3AED", dark: "#7C3AED" });
  });

  test("강조색 위 글자색은 대비 4.5:1 이상", () => {
    for (const hex of ["#C2410C", "#EF7D3C", "#0F766E", "#2DD4BF", "#1D4ED8", "#6FA3FF", "#7C3AED", "#808080", "#FFFF00"]) {
      expect(contrastRatio(hex, onAccent(hex))).toBeGreaterThanOrEqual(4.5);
    }
    expect(onAccent("#C2410C")).toBe("#FFFFFF");
  });
});

describe("getProjectAccent / savePreferences (PGlite)", () => {
  let db: Db;
  let close: () => Promise<void>;
  let userId: string;
  let projectId: string;

  beforeAll(async () => {
    ({ db, close } = await createTestDb());
    const auth = createAuth(db);
    userId = (await signUp(auth, "acc@x.com", "강조")).id;
    projectId = (await makeProject(db, auth, "acc-proj", userId, { defaultProvider: "google" })).project.id;
  });
  afterAll(async () => close());

  test("설정이 없으면 프로젝트 기본 제공자 색", async () => {
    expect(await getProjectAccent(db, projectId, userId)).toBe("#1D4ED8");
  });

  test("프로젝트 accentDefault가 제공자 색보다 앞선다", async () => {
    await db.update(projects).set({ accentDefault: "#7C3AED" }).where(eq(projects.id, projectId));
    expect(await getProjectAccent(db, projectId, userId)).toBe("#7C3AED");
  });

  test("사용자 accentOverride가 가장 앞서고, null로 지우면 프로젝트 기본값으로 돌아간다", async () => {
    await savePreferences(db, userId, { accentOverride: "#0f766e" });
    expect(await getProjectAccent(db, projectId, userId)).toBe("#0F766E");
    await savePreferences(db, userId, { accentOverride: null });
    expect(await getProjectAccent(db, projectId, userId)).toBe("#7C3AED");
  });

  test("다른 사용자의 설정은 영향을 주지 않는다", async () => {
    const other = (await signUp(createAuth(db), "acc2@x.com", "다른")).id;
    await savePreferences(db, userId, { accentOverride: "#0F766E" });
    expect(await getProjectAccent(db, projectId, other)).toBe("#7C3AED");
  });

  test("없는 프로젝트는 null", async () => {
    expect(await getProjectAccent(db, "00000000-0000-4000-8000-000000000000", userId)).toBeNull();
  });

  test("savePreferences: 부분 갱신과 검증", async () => {
    const u = (await signUp(createAuth(db), "acc3@x.com", "셋")).id;
    expect(await getPreferences(db, u)).toEqual({ theme: "system", accentOverride: null });
    expect(await savePreferences(db, u, { theme: "dark" })).toEqual({ theme: "dark", accentOverride: null });
    expect(await savePreferences(db, u, { accentOverride: "#abcdef" })).toEqual({ theme: "dark", accentOverride: "#ABCDEF" });
    await expect(savePreferences(db, u, { accentOverride: "red" })).rejects.toThrow();
    await expect(savePreferences(db, u, { theme: "neon" as never })).rejects.toThrow();
    expect(await getPreferences(db, u)).toEqual({ theme: "dark", accentOverride: "#ABCDEF" });
    const rows = await db.select().from(userPreferences).where(eq(userPreferences.userId, u));
    expect(rows).toHaveLength(1);
  });
});
