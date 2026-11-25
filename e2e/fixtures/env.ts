// E2E 공통 환경. playwright.config(서버·워커)와 global-setup이 같은 값을 쓴다.
export const PG_ADMIN_URL = process.env.E2E_PG_ADMIN_URL ?? "postgres://postgres@127.0.0.1:54329/postgres";
export const E2E_DB_NAME = "mpm_e2e";
export const E2E_DATABASE_URL = PG_ADMIN_URL.replace(/\/[^/]*$/, `/${E2E_DB_NAME}`);
export const E2E_PORT = Number(process.env.PORT ?? 3100);

export const e2eEnv = {
  DATABASE_URL: E2E_DATABASE_URL,
  BETTER_AUTH_SECRET: "e2e-secret-e2e-secret-e2e-secret-1234",
  BETTER_AUTH_URL: `http://localhost:${E2E_PORT}`,
  APP_ENCRYPTION_KEY: "MDEyMzQ1Njc4OWFiY2RlZjAxMjM0NTY3ODlhYmNkZWY=",
  CRON_SECRET: "e2e-cron-secret",
  BLOB_READ_WRITE_TOKEN: "e2e-blob-token",
  MPM_FAKE_AI: "1",
  MPM_FAKE_BLOB: "1",
} as const;
