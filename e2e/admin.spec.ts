import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { readSeed } from "./fixtures/seed";

// 새 프로젝트, 레포 개요, 관리자 화면(Task 16). 리드가 만든 새 프로젝트(①②)와 시드의 Workwrap 프로젝트(③④)를 쓰고,
// 요청자 화면(⑤)은 데모 프로젝트에서 본다. 그룹·멤버는 다른 spec의 데모 프로젝트를 건드리지 않게 Workwrap에만 둔다.
const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");

test.use({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
test.describe.configure({ mode: "serial", timeout: 120_000 });

async function login(page: Page, who: "lead" | "req") {
  const seed = readSeed();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(seed[who].email);
  await page.getByLabel("비밀번호").fill(seed.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
}

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCREENS, name), fullPage: true });
}

let newProjectId = "";

test("① 리드가 새 프로젝트를 만들면 레포 개요로 가서 분석 결과가 나타난다", async ({ page }) => {
  await login(page, "lead");
  await page.goto("/projects/new");
  await page.getByLabel("프로젝트 이름").fill("새로 만든 프로젝트");
  await page.getByLabel("GitHub 주소").fill("https://github.com/acme/new-app");
  await shot(page, "task-16-new-project.png");

  // 잘못된 주소는 폼에서 안내한다.
  await page.getByLabel("GitHub 주소").fill("https://example.com/x");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await expect(page.locator("#main").getByRole("alert")).toContainText("GitHub 주소를 확인해 주세요");

  await page.getByLabel("GitHub 주소").fill("https://github.com/acme/new-app");
  await page.getByRole("button", { name: "프로젝트 만들기" }).click();
  await page.waitForURL(/\/p\/[0-9a-f-]+\/repo$/);
  newProjectId = page.url().split("/p/")[1].split("/")[0];

  // 분석이 끝나면(고정 개요) 기술 스택과 도메인 맵이 보인다. 리드라서 "다시 분석"이 있다.
  await expect(page.getByRole("heading", { name: "기술 스택" })).toBeVisible({ timeout: 30_000 });
  await expect(page.getByText("하루 요약", { exact: true })).toBeVisible();
  await expect(page.getByText("마지막 분석")).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 분석" })).toBeVisible();
  await shot(page, "task-16-repo.png");
});

test("② 리드가 지시사항을 고쳐 저장하면 버전 목록에 v2가 생긴다", async ({ page }) => {
  await login(page, "lead");
  await page.goto(`/p/${newProjectId}/admin/agents`);
  const versions = page.getByRole("list", { name: "해소 검사 버전 목록" });
  await expect(versions.getByText("v1")).toBeVisible();

  const editor = page.getByRole("textbox", { name: "해소 검사 지시사항" });
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(" 우리 팀 용어는 도메인 지식을 먼저 확인해요.");
  await page.getByRole("button", { name: "저장 (새 버전)" }).first().click();

  await expect(versions.getByText("v2")).toBeVisible();
  await expect(page.getByText("현재 v2").first()).toBeVisible();
  await shot(page, "task-16-admin-agents.png");
});

test("③ 그룹 '프론트'를 만들고 개발자를 지정하면 새 티켓의 대상 선택에 보인다", async ({ page }) => {
  const seed = readSeed();
  await login(page, "lead");
  await page.goto(`/p/${seed.claudeProject.id}/admin/groups`);
  const form = page.getByRole("form", { name: "새 그룹" });
  await form.getByLabel("그룹 이름").fill("프론트");
  await form.getByLabel("담당 범위").fill("화면과 입력");
  await form.getByRole("button", { name: "그룹 만들기" }).click();

  const card = page.getByRole("region", { name: "그룹 프론트" });
  await expect(card).toBeVisible();
  await card.getByLabel(new RegExp(seed.dev.name)).check();
  await card.getByRole("button", { name: "그룹원 저장" }).click();
  await expect(page.getByText("그룹원을 저장했어요.")).toBeVisible();
  await expect(card.getByLabel(new RegExp(seed.dev.name))).toBeChecked();
  await page.reload();
  await expect(page.getByRole("region", { name: "그룹 프론트" }).getByLabel(new RegExp(seed.dev.name))).toBeChecked();

  await page.goto(`/p/${seed.claudeProject.id}/tickets/new`);
  await page.getByRole("combobox", { name: "담당 대상" }).click();
  await expect(page.getByRole("option", { name: /프론트/ })).toBeVisible();
});

test("④ 이메일로 초대하면 다른 브라우저로 가입해 요청자로 들어오고, 리드가 개발자로 바꾼다", async ({ page, browser }) => {
  const seed = readSeed();
  await login(page, "lead");
  await page.goto(`/p/${seed.claudeProject.id}/admin/settings`);
  await expect(page.getByText("AI 키 등록은 3차에 열려요. 지금은 시연 프로젝트에서만 AI가 동작해요.")).toBeVisible();
  await expect(page.getByTestId("token-status")).toHaveText("없음");

  // 멤버·초대 섹션으로 옮긴다. 내 행은 (나)로 표시되고 역할 변경·제외가 막혀 있다.
  await page.getByRole("navigation", { name: "관리자 메뉴" }).getByRole("link", { name: "멤버·초대" }).click();
  await page.waitForURL(/\/admin\/members$/);
  const me = page.locator(`[data-member="${seed.lead.email}"]`);
  await expect(me).toContainText("(나)");
  await expect(page.getByLabel(`${seed.lead.name} 역할`)).toBeDisabled();
  await expect(me.getByRole("button", { name: /프로젝트에서 제외/ })).toBeDisabled();

  await page.getByLabel("초대할 이메일").fill("newbie@e2e.test");
  await page.getByLabel("역할", { exact: true }).selectOption("requester");
  await page.getByRole("button", { name: "초대하기" }).click();
  const link = page.getByTestId("invite-link").first();
  await expect(link).toContainText("/invite/");
  const invitePath = (await link.innerText()).trim();

  const ctx = await browser.newContext({ colorScheme: "light" });
  const guest = await ctx.newPage();
  await guest.goto(invitePath);
  await guest.getByLabel("이름").fill("신입요청");
  await guest.getByLabel("비밀번호").fill("password-1234");
  await guest.getByRole("button", { name: "가입하고 참여하기" }).click();
  await guest.waitForURL(/\/p\/.+\/tickets/);
  // 초대 수락 후 /admin은 403, 레포는 열린다(⑤와 같은 규칙).
  await guest.goto(`/p/${seed.claudeProject.id}/admin`);
  await expect(guest.getByRole("heading", { name: "권한이 없어요" })).toBeVisible();
  await ctx.close();

  await page.reload();
  const role = page.getByLabel("신입요청 역할");
  // 서버 HTML만으로도 값은 맞으므로, 핸들러가 붙은(하이드레이션 끝난) 뒤에 고른다.
  await expect(role).toHaveAttribute("data-hydrated", "true");
  await expect(role).toHaveValue("requester");
  await role.selectOption("developer");
  await expect(page.getByText("역할을 바꿨어요.")).toBeVisible({ timeout: 15_000 });
  await expect(role).toHaveValue("developer");
  await page.reload();
  await expect(page.getByLabel("신입요청 역할")).toHaveValue("developer");

  // 플러그인의 조직 변경 엔드포인트는 막혀 있다(R26): 리드 세션으로도 404이고 역할은 그대로다.
  const blocked = await page.request.post("/api/auth/organization/update-member-role", {
    data: { organizationId: "x", memberId: "x", role: "requester" },
  });
  expect(blocked.status()).toBe(404);
  const leave = await page.request.post("/api/auth/organization/leave", { data: { organizationId: "x" } });
  expect(leave.status()).toBe(404);
  await expect(page.getByLabel("신입요청 역할")).toHaveValue("developer");
  await shot(page, "task-16-admin-settings.png");
});

test("⑥ 관리자는 왼쪽 메뉴로 섹션을 나눠 보고, 예전 ?tab= 주소도 해당 섹션으로 간다", async ({ page }) => {
  const seed = readSeed();
  await login(page, "lead");
  await page.goto(`/p/${seed.claudeProject.id}/admin`);
  await page.waitForURL(/\/admin\/domain$/);
  const menu = page.getByRole("navigation", { name: "관리자 메뉴" });
  await expect(menu.getByRole("link")).toHaveText(["도메인 지식", "에이전트", "멤버·초대", "그룹", "프로젝트 설정"]);
  await expect(menu.getByRole("link", { name: "도메인 지식" })).toHaveAttribute("aria-current", "page");
  await expect(page.getByRole("heading", { name: "도메인 지식", level: 2 })).toBeVisible();

  // 섹션은 자기 데이터만 그린다: 그룹 화면에는 멤버 초대 폼이 없다.
  await menu.getByRole("link", { name: "그룹" }).click();
  await page.waitForURL(/\/admin\/groups$/);
  await expect(page.getByRole("heading", { name: "그룹", level: 2 })).toBeVisible();
  await expect(page.getByRole("form", { name: "멤버 초대" })).toHaveCount(0);
  await expect(menu.getByRole("link", { name: "그룹" })).toHaveAttribute("aria-current", "page");
  await expect(page).toHaveTitle("그룹 · 관리자 · MyProjectManager");

  await page.goto(`/p/${seed.claudeProject.id}/admin?tab=settings`);
  await page.waitForURL(/\/admin\/members$/);
  await page.goto(`/p/${seed.claudeProject.id}/admin?tab=agents`);
  await page.waitForURL(/\/admin\/agents$/);

  // 좁은 화면에서는 메뉴가 가로로 한 줄이고 페이지 전체가 옆으로 넘치지 않는다.
  await page.setViewportSize({ width: 375, height: 800 });
  await page.goto(`/p/${seed.claudeProject.id}/admin/domain`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
});

test("⑤ 요청자는 /admin이 403이고 /repo는 열리지만 '다시 분석'은 없다", async ({ page }) => {
  const seed = readSeed();
  await login(page, "req");
  await page.goto(`/p/${seed.demoProject.id}/admin`);
  await expect(page.getByRole("heading", { name: "권한이 없어요" })).toBeVisible();
  await expect(page.getByRole("link", { name: "관리자" })).toHaveCount(0);

  await page.goto(`/p/${seed.demoProject.id}/repo`);
  await expect(page.getByRole("heading", { name: "레포", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "다시 분석" })).toHaveCount(0);

  // 멤버가 아닌 프로젝트는 404.
  // (스트리밍 응답이라 상태 코드는 200으로 나가므로 화면으로 확인한다.)
  await page.goto(`/p/${newProjectId}/admin`);
  await expect(page.getByText("This page could not be found.")).toBeVisible();
  await expect(page.getByRole("heading", { name: "권한이 없어요" })).toHaveCount(0);
});
