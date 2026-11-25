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

test("BLOB_READ_WRITE_TOKEN과 BLOB_STORE_ID가 없어도 통과 (OIDC 연결)", async () => {
  vi.stubEnv("BLOB_READ_WRITE_TOKEN", "");
  vi.stubEnv("BLOB_STORE_ID", "");
  vi.resetModules();
  const { env } = await import("@/lib/env");
  expect(env.BLOB_READ_WRITE_TOKEN).toBeUndefined();
  expect(env.BLOB_STORE_ID).toBeUndefined();
});
