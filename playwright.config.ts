import { defineConfig } from "@playwright/test";
import { e2eEnv, E2E_PORT } from "./e2e/fixtures/env";

// global-setup과 워커(DB 접근)가 같은 환경 변수를 보도록 한다.
Object.assign(process.env, e2eEnv);

export default defineConfig({
  testDir: "./e2e",
  globalSetup: "./e2e/global-setup.ts",
  fullyParallel: false,
  workers: 1,
  reporter: "list",
  use: {
    baseURL: `http://localhost:${E2E_PORT}`,
    // 샌드박스에는 Playwright 브라우저가 없어 시스템 Chrome을 쓴다.
    channel: "chrome",
    trace: "retain-on-failure",
  },
  webServer: {
    command: `pnpm exec next dev -p ${E2E_PORT}`,
    url: `http://localhost:${E2E_PORT}/login`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
    env: { ...e2eEnv },
  },
});
