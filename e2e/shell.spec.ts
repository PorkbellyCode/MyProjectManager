import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { readSeed, resetPreferences } from "./fixtures/seed";

const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");

// 라이트 모드 기준 색
const CLAUDE_LIGHT = "rgb(194, 65, 12)"; // #C2410C
const CHATGPT_LIGHT = "rgb(15, 118, 110)"; // #0F766E
const GEMINI_LIGHT = "rgb(29, 78, 216)"; // #1D4ED8

test.use({ colorScheme: "light" });
test.beforeEach(async () => {
  await resetPreferences();
});

async function login(page: Page, who: "lead" | "dev" = "lead") {
  const seed = readSeed();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(seed[who].email);
  await page.getByLabel("비밀번호").fill(seed.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
  // 셸의 클라이언트 코드(단축키 등)가 붙을 때까지 기다린다.
  await page.locator("html[data-shell-ready]").waitFor({ state: "attached" });
}

const primaryButton = (page: Page) => page.getByRole("link", { name: "새 티켓" });
const bg = (page: Page) => primaryButton(page).evaluate((el) => getComputedStyle(el).backgroundColor);

async function openProfile(page: Page) {
  await page.getByRole("button", { name: "프로필 메뉴" }).click();
}

test("로그인하면 프로젝트 티켓 목록으로 가고, 비로그인은 /login으로 간다", async ({ page, context }) => {
  await page.goto("/");
  await expect(page).toHaveURL(/\/login$/);
  await login(page);
  await expect(page).toHaveURL(new RegExp(`/p/${readSeed().claudeProject.id}/tickets`));
  await context.clearCookies();
  await page.goto("/notifications");
  await expect(page).toHaveURL(/\/login$/);
});

test("① Ctrl+K 팔레트에서 '알림'을 고르면 /notifications로 이동한다", async ({ page }) => {
  await login(page);
  await page.keyboard.press("Control+K");
  const input = page.getByPlaceholder("이동할 곳을 검색하세요");
  await expect(input).toBeVisible();
  await input.fill("알림");
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/notifications$/);
});

test("상단 메뉴는 티켓·레포이고 관리자는 리드에게만 보인다", async ({ page, context }) => {
  await login(page, "lead");
  const nav = page.getByRole("navigation", { name: "프로젝트 메뉴" });
  await expect(nav.getByRole("link", { name: "티켓" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "레포" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "관리자" })).toBeVisible();
  await context.clearCookies();
  await login(page, "dev");
  await expect(nav.getByRole("link", { name: "레포" })).toBeVisible();
  await expect(nav.getByRole("link", { name: "관리자" })).toHaveCount(0);
});

test("② 강조색을 옥색으로 바꾸면 주요 버튼이 바뀌고, 프로젝트 기본값으로 되돌린다 ③ 새로고침 후에도 유지된다", async ({
  page,
}) => {
  await login(page);
  expect(await bg(page)).toBe(CLAUDE_LIGHT);

  await openProfile(page);
  await page.getByRole("button", { name: /ChatGPT 옥색/ }).click();
  await expect.poll(() => bg(page)).toBe(CHATGPT_LIGHT);
  await expect(page.getByText("강조색을 바꿨어요")).toBeVisible();
  // 포털(팝오버)에도 강조색이 닿는다: 선택된 프리셋의 테두리
  await expect(page.getByRole("button", { name: "ChatGPT 옥색" })).toHaveCSS("border-top-color", CHATGPT_LIGHT);

  // ③ 새로고침 후 유지 + 서버가 응답 HTML에 이미 강조색을 넣어 보낸다(첫 페인트부터 적용 = 깜빡임 없음)
  await page.reload();
  expect(await bg(page)).toBe(CHATGPT_LIGHT);
  const html = await (await page.context().request.get(page.url())).text();
  expect(html).toContain("html:root{--accent-l:#0F766E");
  expect(html).toContain("--accent-d:#2DD4BF");

  await openProfile(page);
  await page.getByRole("button", { name: "프로젝트 기본값으로" }).click();
  await expect.poll(() => bg(page)).toBe(CLAUDE_LIGHT);
  await page.reload();
  expect(await bg(page)).toBe(CLAUDE_LIGHT);
});

test("직접 입력한 강조색이 적용되고 잘못된 값은 거절한다", async ({ page }) => {
  await login(page);
  await openProfile(page);
  const hex = page.getByLabel("직접 입력");
  await hex.fill("#12");
  await hex.press("Enter");
  await expect(page.getByText("#RRGGBB 형식으로 입력해 주세요")).toBeVisible();
  await hex.fill("#7C3AED");
  await hex.press("Enter");
  await expect.poll(() => bg(page)).toBe("rgb(124, 58, 237)");
});

test("④ 프로젝트 기본 제공자가 google이면 기본 강조색은 #1D4ED8이다", async ({ page }) => {
  const seed = readSeed();
  await login(page);
  await page.goto(`/p/${seed.geminiProject.id}/tickets`);
  expect(await bg(page)).toBe(GEMINI_LIGHT);
  // 포털(Ctrl+K 다이얼로그)에서도 강조색은 파랑이다. 다이얼로그 안에 임시 요소를 붙여 --brand를 직접 읽는다.
  await page.locator("html[data-shell-ready]").waitFor({ state: "attached" });
  await page.keyboard.press("Control+K");
  const input = page.getByPlaceholder("이동할 곳을 검색하세요");
  await expect(input).toBeVisible();
  const brand = await input.evaluate((el) => {
    const probe = document.createElement("span");
    probe.style.color = "var(--brand)";
    el.closest("[role=dialog]")!.appendChild(probe);
    const c = getComputedStyle(probe).color;
    probe.remove();
    return c;
  });
  expect(brand).toBe(GEMINI_LIGHT);
});

test("다크 테마는 저장되고 새로고침해도 유지되며 강조색이 다크 값으로 바뀐다", async ({ page }) => {
  await login(page);
  await openProfile(page);
  await page.getByRole("radio", { name: "다크" }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect.poll(() => bg(page)).toBe("rgb(239, 125, 60)"); // #EF7D3C
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await bg(page)).toBe("rgb(239, 125, 60)");
});

test("스크린샷: 라이트와 다크 셸", async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await login(page);
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SCREENS, "task-12-light.png") });
  await openProfile(page);
  await page.getByRole("radio", { name: "다크" }).click();
  await page.keyboard.press("Escape");
  await page.waitForTimeout(700);
  await page.screenshot({ path: path.join(SCREENS, "task-12-dark.png") });
});

test("좁은 화면: 상단 바는 한 줄이고, 메뉴 버튼 서랍과 프로젝트 전환(새 프로젝트)이 있다", async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  await login(page, "lead");
  const header = page.locator("header").first();
  expect((await header.boundingBox())!.height).toBeLessThanOrEqual(64);
  await expect(page.getByRole("navigation", { name: "프로젝트 메뉴", exact: true })).toBeHidden();
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(375);

  // 검색은 아이콘 버튼(접근성 이름 있음)
  await page.getByRole("button", { name: "이동하거나 검색하기" }).click();
  await expect(page.getByPlaceholder("이동할 곳을 검색하세요")).toBeVisible();
  await page.keyboard.press("Escape");
  // 닫으면 포커스가 검색 버튼으로 돌아온다(5-3).
  await expect(page.getByRole("button", { name: "이동하거나 검색하기" })).toBeFocused();

  await page.getByRole("button", { name: "메뉴 열기" }).click();
  const drawer = page.getByRole("dialog", { name: "MyProjectManager" });
  await drawer.getByRole("link", { name: "레포" }).click();
  await expect(page).toHaveURL(/\/repo$/);
  await expect(drawer).toBeHidden();

  await page.getByRole("button", { name: /프로젝트 전환/ }).click();
  await expect(page.getByRole("menuitem", { name: "새 프로젝트" })).toBeVisible();
  await expect(page.getByRole("menuitem", { name: readSeed().claudeProject.name, exact: true })).toBeVisible();
});
