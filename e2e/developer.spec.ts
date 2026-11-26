import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { readSeed, seedTicket } from "./fixtures/seed";

// 개발자·리드 화면(Task 15). 티켓은 서비스로 바로 만들고(R4), 처리는 화면에서 한다.
// 제목은 requester.spec ①의 제목("오늘 요약 항목이 또 두 번 보여요")과 낱말이 겹치지 않게 둔다: 가짜 AI의 중복 규칙이
// 낱말이 겹치는 가장 최근 티켓을 후보로 고르므로, 겹치면 그 테스트의 원본 후보가 바뀐다.
const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");
type Who = "req" | "lead" | "dev" | "fe" | "be";

test.use({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
// 여러 사람이 번갈아 처리하는 긴 흐름이라 기본 30초보다 넉넉히 둔다(개발 서버의 첫 컴파일 포함).
test.describe.configure({ timeout: 120_000 });

async function login(page: Page, who: Who) {
  const seed = readSeed();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(seed[who].email);
  await page.getByLabel("비밀번호").fill(seed.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
}

async function as(browser: Browser, who: Who): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, who);
  return { ctx, page };
}

const list = (view: string) => `/p/${readSeed().demoProject.id}/tickets?view=${view}`;
const detail = (id: string) => `/p/${readSeed().demoProject.id}/tickets/${id}`;
const ticketStatus = (page: Page) => page.getByRole("status", { name: "티켓 상태" });
const panel = (page: Page) => page.getByRole("region", { name: "처리" });
const table = (page: Page) => page.getByRole("table", { name: "티켓 목록" });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600); // 등장 애니메이션이 끝난 뒤 찍는다(스크린샷 전용)
  await page.screenshot({ path: path.join(SCREENS, name), fullPage: true });
}

/** 알림 화면에서 그 티켓의 알림을 눌러 상세로 간다(읽음 처리 후 이동). */
async function openNotification(page: Page, title: string, kind: string | RegExp) {
  await page.goto("/notifications");
  const item = page.getByRole("link", { name: new RegExp(title) }).filter({ hasText: kind }).first();
  await expect(item).toBeVisible();
  await item.click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
}

test("① 그룹 큐 가져가기 → 보류 → 재개 → 처리 완료(PR) → 요청자 아직이에요 → 알림 → 처리 완료 → 고쳐졌어요", async ({ browser }) => {
  const seed = readSeed();
  const t = await seedTicket({ title: "프로필 사진이 업로드 뒤 사라져요", target: { kind: "group", groupId: seed.groups.frontend.id }, urgency: "high" });
  const fe = await as(browser, "fe");
  const req = await as(browser, "req");

  await fe.page.goto(list("group"));
  await table(fe.page).getByRole("link", { name: t.title }).click();
  await expect(ticketStatus(fe.page)).toHaveText("큐 대기");
  await panel(fe.page).getByRole("button", { name: "가져가기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("진행중");
  await shot(fe.page, "task-15-actions.png");

  await panel(fe.page).getByRole("button", { name: "보류" }).click();
  const hold = fe.page.getByRole("dialog", { name: "보류할까요?" });
  await hold.getByRole("button", { name: "보류하기" }).click();
  await expect(hold.getByText("보류 사유를 적어 주세요.")).toBeVisible();
  await hold.getByRole("textbox", { name: "보류 사유" }).fill("디자인 확정을 기다려요");
  await hold.getByRole("button", { name: "보류하기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("보류");
  await expect(fe.page.getByRole("region", { name: "활동" }).getByText("디자인 확정을 기다려요")).toBeVisible();

  await panel(fe.page).getByRole("button", { name: "재개" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("진행중");

  await panel(fe.page).getByRole("button", { name: "처리 완료" }).click();
  const resolve = fe.page.getByRole("dialog", { name: "처리 완료로 표시할까요?" });
  await resolve.getByRole("textbox", { name: "PR 번호" }).fill("12");
  await resolve.getByRole("button", { name: "처리 완료하기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("확인 대기");

  // 요청자: 확인 대기 뷰에 있고, 아직이에요(사유)
  await req.page.goto(list("confirm"));
  await expect(req.page.getByRole("tab", { name: /확인 대기/ })).toHaveAttribute("aria-selected", "true");
  await table(req.page).getByRole("link", { name: t.title }).click();
  const confirm = req.page.getByRole("region", { name: "처리 확인" });
  await expect(confirm.getByRole("link", { name: /PR #12/ })).toBeVisible();
  await confirm.getByRole("button", { name: "아직이에요" }).click();
  await confirm.getByRole("textbox", { name: "아직인 이유" }).fill("모바일에서는 여전히 사라져요");
  await confirm.getByRole("button", { name: "다시 열기" }).click();
  await expect(ticketStatus(req.page)).toHaveText("진행중");

  // fe: 알림 → 상세 → 처리 완료
  await openNotification(fe.page, t.title, "아직이에요");
  await expect(ticketStatus(fe.page)).toHaveText("진행중");
  await panel(fe.page).getByRole("button", { name: "처리 완료" }).click();
  await fe.page.getByRole("dialog", { name: "처리 완료로 표시할까요?" }).getByRole("button", { name: "처리 완료하기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("확인 대기");

  // 요청자: 고쳐졌어요 → 종결(해결 확인)
  await req.page.reload();
  await req.page.getByRole("region", { name: "처리 확인" }).getByRole("button", { name: "고쳐졌어요" }).click();
  await expect(ticketStatus(req.page)).toHaveText("종결");
  await expect(req.page.getByRole("complementary", { name: "티켓 정보" }).getByText("해결 확인")).toBeVisible();

  await fe.ctx.close();
  await req.ctx.close();
});

test("② 같은 그룹의 두 개발자가 동시에 가져가기 → 한쪽은 충돌 안내", async ({ browser }) => {
  const seed = readSeed();
  const t = await seedTicket({ title: "배포 후 설정 값이 초기화돼요", target: { kind: "group", groupId: seed.platform.id } });
  const fe = await as(browser, "fe");
  const be = await as(browser, "be");
  await fe.page.goto(detail(t.id));
  await be.page.goto(detail(t.id));
  await expect(panel(fe.page).getByRole("button", { name: "가져가기" })).toBeVisible();
  await expect(panel(be.page).getByRole("button", { name: "가져가기" })).toBeVisible();

  await panel(fe.page).getByRole("button", { name: "가져가기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("진행중");
  await panel(be.page).getByRole("button", { name: "가져가기" }).click();
  await expect(be.page.getByText("이미 다른 사람이 처리했어요. 새로고침해 주세요.")).toBeVisible();
  await expect(ticketStatus(be.page)).toHaveText("진행중");
  await expect(be.page.getByRole("complementary", { name: "티켓 정보" }).getByText(seed.fe.name)).toBeVisible();

  await fe.ctx.close();
  await be.ctx.close();
});

test("③ 이관(서버 그룹, 사유) → be 알림, 백엔드 그룹 큐에 표시", async ({ browser }) => {
  const seed = readSeed();
  const t = await seedTicket({ title: "메모 API가 가끔 500을 돌려줘요", target: { kind: "group", groupId: seed.groups.frontend.id } });
  const fe = await as(browser, "fe");
  const be = await as(browser, "be");

  await fe.page.goto(detail(t.id));
  await panel(fe.page).getByRole("button", { name: "이관" }).click();
  const dialog = fe.page.getByRole("dialog", { name: "티켓을 이관할까요?" });
  await dialog.getByRole("combobox", { name: "이관할 대상" }).click();
  await fe.page.getByRole("option", { name: new RegExp(`^${seed.groups.backend.name}`) }).click();
  await dialog.getByRole("textbox", { name: "이관 사유" }).fill("서버 응답 문제라 백엔드가 봐야 해요");
  await dialog.getByRole("button", { name: "이관하기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("큐 대기");
  await expect(fe.page.getByRole("complementary", { name: "티켓 정보" }).getByText(seed.groups.backend.name)).toBeVisible();

  await openNotification(be.page, t.title, "이관");
  await expect(be.page.getByRole("heading", { name: t.title })).toBeVisible();
  await be.page.goto(list("group"));
  await expect(table(be.page).getByRole("link", { name: t.title })).toBeVisible();

  await fe.ctx.close();
  await be.ctx.close();
});

test("④ 개발자 종결 다이얼로그에 '안 하기로 함' 없음 → 제안 → lead 알림 → lead가 안 하기로 함 종결", async ({ browser }) => {
  const seed = readSeed();
  const t = await seedTicket({ title: "다크 모드에서 로고를 바꿔 주세요", target: { kind: "group", groupId: seed.groups.frontend.id } });
  const fe = await as(browser, "fe");
  const lead = await as(browser, "lead");

  await fe.page.goto(detail(t.id));
  await panel(fe.page).getByRole("button", { name: "가져가기" }).click();
  await expect(ticketStatus(fe.page)).toHaveText("진행중");
  await panel(fe.page).getByRole("button", { name: "종결" }).click();
  const close = fe.page.getByRole("dialog", { name: "티켓을 종결할까요?" });
  const reasons = close.getByRole("radiogroup", { name: "종결 사유" });
  await expect(reasons.getByRole("radio", { name: "중복" })).toBeVisible();
  await expect(reasons.getByRole("radio", { name: "안 하기로 함" })).toHaveCount(0);
  await reasons.getByRole("radio", { name: "중복" }).click();
  await expect(close.getByRole("textbox", { name: "원본 티켓 번호" })).toBeVisible();
  await shot(fe.page, "task-15-close-dialog.png");
  await fe.page.keyboard.press("Escape");

  await panel(fe.page).getByRole("button", { name: "안 하기로 함 제안" }).click();
  const propose = fe.page.getByRole("dialog", { name: "안 하기로 하자고 제안할까요?" });
  await propose.getByRole("textbox", { name: "제안 사유" }).fill("브랜드 가이드상 로고는 하나만 써요");
  await propose.getByRole("button", { name: "제안하기" }).click();
  await expect(fe.page.getByRole("region", { name: "활동" }).getByText("브랜드 가이드상 로고는 하나만 써요")).toBeVisible();

  await openNotification(lead.page, t.title, "안 하기로 함 제안");
  await panel(lead.page).getByRole("button", { name: "종결" }).click();
  const leadClose = lead.page.getByRole("dialog", { name: "티켓을 종결할까요?" });
  await leadClose.getByRole("radiogroup", { name: "종결 사유" }).getByRole("radio", { name: "안 하기로 함" }).click();
  await leadClose.getByRole("button", { name: "종결하기" }).click();
  await expect(ticketStatus(lead.page)).toHaveText("종결");
  await expect(lead.page.getByRole("complementary", { name: "티켓 정보" }).getByText("안 하기로 함")).toBeVisible();

  await fe.ctx.close();
  await lead.ctx.close();
});

test("⑤ 리드 큐 티켓(AI 추천 참고)을 lead가 사람에게 지정 → 그 사람의 내 티켓에 배정됨", async ({ browser }) => {
  const seed = readSeed();
  const t = await seedTicket({
    title: "알림 메일이 2통씩 와요",
    target: null,
    urgency: "urgent",
    recommend: { target: { kind: "group", groupId: seed.groups.backend.id }, reason: "메일 발송은 백엔드 담당 범위예요." },
  });
  const lead = await as(browser, "lead");
  const dev = await as(browser, "dev");

  await lead.page.goto(list("lead"));
  const row = table(lead.page).getByRole("row").filter({ hasText: t.title });
  await expect(row.getByText(`추천 ${seed.groups.backend.name}`).filter({ visible: true })).toBeVisible();
  await shot(lead.page, "task-15-lead-queue.png");
  await row.getByRole("link", { name: t.title }).click();

  await expect(panel(lead.page).getByText("메일 발송은 백엔드 담당 범위예요.")).toBeVisible();
  await panel(lead.page).getByRole("button", { name: "대상 지정" }).click();
  const assign = lead.page.getByRole("dialog", { name: "대상을 정할까요?" });
  const picker = assign.getByRole("combobox", { name: "지정할 대상" });
  await expect(picker).toContainText(seed.groups.backend.name);
  await picker.click();
  await lead.page.getByRole("option", { name: new RegExp(seed.dev.name) }).click();
  await assign.getByRole("button", { name: "지정하기" }).click();
  await expect(ticketStatus(lead.page)).toHaveText("배정됨");

  await dev.page.goto(list("mine"));
  await expect(dev.page.getByRole("tab", { name: /내 티켓/ })).toHaveAttribute("aria-selected", "true");
  await table(dev.page).getByRole("link", { name: t.title }).click();
  await expect(panel(dev.page).getByRole("button", { name: "수락" })).toBeVisible();

  await lead.ctx.close();
  await dev.ctx.close();
});

test("⑥ ?view=group은 새로고침 뒤에도 유지되고, Ctrl+K → #1 → 1번 상세", async ({ page }) => {
  const seed = readSeed();
  await seedTicket({ title: "긴급: 저장이 안 돼요", target: { kind: "group", groupId: seed.groups.frontend.id }, urgency: "urgent" });
  await login(page, "fe");
  await page.goto(list("group"));
  await page.getByRole("group", { name: "긴급도" }).getByRole("button", { name: "긴급" }).click();
  await expect(page).toHaveURL(/urgency=urgent/);
  await page.getByRole("group", { name: "긴급도" }).getByRole("button", { name: "높음" }).click();
  await expect(page).toHaveURL(/urgency=urgent(,|%2C)high/);
  await expect(table(page).getByRole("link", { name: "긴급: 저장이 안 돼요" })).toBeVisible();

  await page.reload();
  await expect(page.getByRole("tab", { name: /내 그룹 큐/ })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("group", { name: "긴급도" }).getByRole("button", { name: "긴급" })).toHaveAttribute("aria-pressed", "true");
  await expect(table(page).getByRole("link", { name: "긴급: 저장이 안 돼요" })).toBeVisible();
  await shot(page, "task-15-list.png");

  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await expect(table(page)).toBeVisible();
  await shot(page, "task-15-list-dark.png");
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();

  await expect(page.locator("html[data-shell-ready]")).toHaveCount(1);
  await page.keyboard.press("Control+k");
  const palette = page.getByRole("dialog", { name: "명령 팔레트" });
  await palette.getByRole("combobox").fill("#1");
  await expect(palette.getByRole("option", { name: new RegExp(seed.origin.title) })).toBeVisible();
  await page.keyboard.press("Enter");
  await page.waitForURL(new RegExp(`/tickets/${seed.origin.id}$`));
  await expect(page.getByRole("heading", { name: seed.origin.title })).toBeVisible();
});

test("알림 화면: 최근 알림을 누르면 읽음 처리되고 배지가 줄어든다", async ({ page }) => {
  const seed = readSeed();
  const t = await seedTicket({ title: "검색 결과가 비어 있어요", target: { kind: "user", userId: seed.be.id } });
  await login(page, "be");
  await page.goto("/notifications");
  const item = page.getByRole("link", { name: new RegExp(t.title) }).first();
  await expect(item).toBeVisible();
  await expect(item).toContainText("읽지 않음");
  await shot(page, "task-15-notifications.png");
  const badge = page.getByRole("link", { name: /^알림/ }).first();
  const before = Number((await badge.getAttribute("aria-label"))?.match(/\d+/)?.[0] ?? 0);
  expect(before).toBeGreaterThan(0);
  await item.click();
  await page.waitForURL(new RegExp(`/tickets/${t.id}$`));
  await expect.poll(async () => Number((await badge.getAttribute("aria-label"))?.match(/\d+/)?.[0] ?? 0)).toBeLessThan(before);
});
