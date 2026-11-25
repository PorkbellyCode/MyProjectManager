import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("필수 환경 변수가 없으면 시작 시 실패", async () => {
  vi.stubEnv("DATABASE_URL", "");
  vi.resetModules();
  await expect(import("@/lib/env")).rejects.toThrow(/DATABASE_URL/);
});

test("필수 값이 모두 있으면 선택 변수는 비어 있어도 통과", async () => {
  vi.resetModules();
  const { env } = await import("@/lib/env");
  expect(env.DATABASE_URL).toBeTruthy();
  expect(env.ANTHROPIC_API_KEY).toBeUndefined();
});
