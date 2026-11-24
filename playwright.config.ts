import { defineConfig } from "@playwright/test";

const PORT = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${PORT}`,
    // 샌드박스에는 Playwright 브라우저가 없어 시스템 Chrome을 쓴다.
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev -p ${PORT}`,
    url: `http://localhost:${PORT}`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
    env: { MPM_FAKE_AI: "1", MPM_FAKE_BLOB: "1" },
  },
});
