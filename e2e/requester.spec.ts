import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { Pool } from "pg";
import { readSeed } from "./fixtures/seed";
import { E2E_DATABASE_URL } from "./fixtures/env";

// 요청자 화면(Task 14). MPM_FAKE_AI=1의 규칙 표(lib/ai/fake-rules.ts)로 검토가 결정적으로 흐른다.
const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");
const AI_WAIT = { timeout: 30_000 };

test.use({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });

async function login(page: Page, who: "req" | "lead" = "req") {
  const seed = readSeed();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(seed[who].email);
  await page.getByLabel("비밀번호").fill(seed.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
}

async function openNewTicket(page: Page, projectId = readSeed().demoProject.id) {
  await page.goto(`/p/${projectId}/tickets/new`);
  await expect(page.getByRole("heading", { name: "새 티켓" })).toBeVisible();
}

async function fillTicket(page: Page, input: { title: string; body: string; category?: string }) {
  await page.getByRole("textbox", { name: "제목" }).fill(input.title);
  const body = page.getByRole("textbox", { name: "본문" });
  await body.click();
  await page.keyboard.type(input.body);
  if (input.category) await page.getByRole("radio", { name: input.category }).click();
}

const ticketStatus = (page: Page) => page.getByRole("status", { name: "티켓 상태" });

async function ticketIdFromUrl(page: Page): Promise<string> {
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1)!;
}

async function discardedJudgments(ticketId: string): Promise<number> {
  const pool = new Pool({ connectionString: E2E_DATABASE_URL });
  try {
    const { rows } = await pool.query("select count(*)::int as n from ai_judgments where ticket_id = $1 and status = 'discarded'", [ticketId]);
    return rows[0].n as number;
  } finally {
    await pool.end();
  }
}

test("① 본문에 '중복' → AI 검토 요청 → 중복 카드 → 같은 건이에요 → 철회(AI 해소), 원본 타임라인에 합류 댓글", async ({ page }) => {
  const seed = readSeed();
  await login(page);
  await openNewTicket(page);
  await fillTicket(page, { title: "오늘 요약 항목이 또 두 번 보여요", body: "중복으로 들어가는 것 같아요. 어제도 그랬어요." });
  await page.getByRole("button", { name: "AI 검토 요청" }).click();
  await ticketIdFromUrl(page);

  const card = page.getByRole("region", { name: "중복 확인 결과" });
  await expect(card).toBeVisible(AI_WAIT);
  await expect(card.getByRole("link", { name: new RegExp(seed.origin.title) })).toBeVisible();
  await expect(card.getByText("증상과 화면이 같아 보여요")).toBeVisible();
  await page.waitForTimeout(600); // 등장 애니메이션이 끝난 뒤 찍는다(스크린샷 전용)
  await page.screenshot({ path: path.join(SCREENS, "task-14-duplicate.png"), fullPage: true });

  await card.getByRole("button", { name: "같은 건이에요" }).click();
  await expect(ticketStatus(page)).toHaveText("철회(AI 해소)");
  await expect(page.getByText("기존 티켓에 합류했어요")).toBeVisible();

  await page.goto(`/p/${seed.demoProject.id}/tickets/${seed.origin.id}`);
  const activity = page.getByRole("region", { name: "활동" });
  await expect(activity.getByText("[같은 건으로 합류] 오늘 요약 항목이 또 두 번 보여요")).toBeVisible();
});

test("② 검토 → 질문 라운드 1/2 → 2/2 → 준비 카드의 추천 그룹을 바꿔서 제출 → 큐 대기", async ({ page }) => {
  const seed = readSeed();
  await login(page);
  await openNewTicket(page);
  await fillTicket(page, { title: "주간 리포트 차트가 비어 보여요", body: "리포트 화면에서 차트가 그려지지 않아요." });
  await page.screenshot({ path: path.join(SCREENS, "task-14-form.png"), fullPage: true });
  await page.getByRole("button", { name: "AI 검토 요청" }).click();
  const ticketId = await ticketIdFromUrl(page);

  // 중복 없음 → 해소 카드 없음 → 질문 라운드 1/2
  const round1 = page.getByRole("region", { name: "질문 라운드 1/2" });
  await expect(round1).toBeVisible(AI_WAIT);
  await expect(page.getByRole("region", { name: "중복 확인 결과" })).toHaveCount(0);
  await expect(page.getByRole("region", { name: "해소 확인 결과" })).toHaveCount(0);
  const where = round1.getByRole("radiogroup", { name: "어디서 겪으셨나요?" });
  await expect(where.getByRole("radio", { name: "직접 입력" })).toBeVisible();
  await expect(where.getByRole("radio", { name: "모르겠어요" })).toBeVisible();
  await where.getByRole("radio", { name: "PC 웹" }).click();
  await round1.getByRole("radiogroup", { name: "매번 그런가요?" }).getByRole("radio", { name: "가끔" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCREENS, "task-14-questions.png"), fullPage: true });

  // 다크 화면(시스템 설정을 따르는 기본값이라 저장하지 않고 미디어만 바꾼다)
  await page.emulateMedia({ colorScheme: "dark" });
  await page.reload();
  await expect(page.getByRole("region", { name: "질문 라운드 1/2" })).toBeVisible();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("radiogroup", { name: "어디서 겪으셨나요?" }).getByRole("radio", { name: "PC 웹" }).click();
  await page.getByRole("radiogroup", { name: "매번 그런가요?" }).getByRole("radio", { name: "가끔" }).click();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCREENS, "task-14-questions-dark.png"), fullPage: true });
  await page.emulateMedia({ colorScheme: "light" });
  await page.reload();

  const again = page.getByRole("region", { name: "질문 라운드 1/2" });
  await again.getByRole("radiogroup", { name: "어디서 겪으셨나요?" }).getByRole("radio", { name: "PC 웹" }).click();
  await again.getByRole("radiogroup", { name: "매번 그런가요?" }).getByRole("radio", { name: "가끔" }).click();
  await again.getByRole("button", { name: "답변 보내기" }).click();

  const round2 = page.getByRole("region", { name: "질문 라운드 2/2" });
  await expect(round2).toBeVisible(AI_WAIT);
  await round2.getByRole("textbox", { name: "어떤 순서로 하면 문제가 생기나요?" }).fill("리포트 메뉴 → 주간 탭 → 차트 영역");
  await round2.getByRole("button", { name: "답변 보내기" }).click();

  // 준비 카드: 추천 그룹(이름순 첫 그룹)이 미리 채워져 있다
  const ready = page.getByRole("region", { name: "제출 준비" });
  await expect(ready).toBeVisible(AI_WAIT);
  const picker = ready.getByRole("combobox", { name: "담당 대상" });
  await expect(picker).toContainText(seed.groups.backend.name);
  await expect(ready.getByText(`'${seed.groups.backend.name}' 그룹의 담당 범위와 가장 가까워 보여요.`)).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCREENS, "task-14-ready.png"), fullPage: true });

  await picker.click();
  await page.getByRole("option", { name: new RegExp(seed.groups.frontend.name) }).click();
  await expect(picker).toContainText(seed.groups.frontend.name);
  await ready.getByRole("button", { name: "제출", exact: true }).click();

  await expect(ticketStatus(page)).toHaveText("큐 대기");
  const info = page.getByRole("complementary", { name: "티켓 정보" });
  await expect(info.getByText(seed.groups.frontend.name)).toBeVisible();
  expect(ticketId).toMatch(/^[0-9a-f-]{36}$/);
});

test("③ 검토 진행 중 그대로 제출 → 큐 대기, 늦게 끝난 검토가 상태를 되돌리지 않는다", async ({ page }) => {
  await login(page);
  await openNewTicket(page);
  // '천천히'는 가짜 AI가 단계마다 잠시 멈추게 하는 규칙이다(검토 진행 화면을 결정적으로 보이기 위해).
  await fillTicket(page, { title: "설정 저장 버튼이 반응하지 않아요", body: "천천히 봐 주세요. 저장 버튼을 눌러도 아무 일이 없어요." });
  await page.getByRole("button", { name: "AI 검토 요청" }).click();
  const ticketId = await ticketIdFromUrl(page);

  const progress = page.getByRole("region", { name: "AI 검토 진행" });
  await expect(progress).toBeVisible();
  await expect(progress.getByText("화면을 떠나도 돼요. 준비되면 알림을 드릴게요.")).toBeVisible();
  await expect(progress.locator('[aria-current="step"]')).toHaveText(/중복 확인 중/);
  await page.waitForTimeout(600); // 등장 애니메이션이 끝난 뒤 찍는다(스크린샷 전용, 검토는 5초 동안 멈춰 있다)
  await page.screenshot({ path: path.join(SCREENS, "task-14-reviewing.png"), fullPage: true });

  await progress.getByRole("button", { name: "그대로 제출" }).click();
  await expect(ticketStatus(page)).toHaveText("큐 대기");

  // 진행 중이던 검토 작업이 끝나 버려질 때까지 기다린 뒤에도 그대로다.
  await expect.poll(() => discardedJudgments(ticketId), { timeout: 30_000 }).toBeGreaterThan(0);
  await page.reload();
  await expect(ticketStatus(page)).toHaveText("큐 대기");
  await expect(page.getByRole("region", { name: "AI 검토 진행" })).toHaveCount(0);
});

test("④ 바로 제출 → 정리본에 '인터뷰 없이 제출됨'", async ({ page }) => {
  await login(page);
  await openNewTicket(page);
  await fillTicket(page, { title: "알림 설정 화면의 안내 문구를 바꿔 주세요", body: "알림 끄기 설명이 길어서 한눈에 안 들어와요.", category: "개선사항" });
  await page.getByRole("button", { name: "바로 제출" }).click();
  await ticketIdFromUrl(page);

  await expect(ticketStatus(page)).toHaveText("큐 대기");
  const summary = page.getByRole("region", { name: "정리본" });
  await expect(summary.getByText("인터뷰 없이 제출됨").first()).toBeVisible(AI_WAIT);
  await expect(page.getByRole("region", { name: "원문" })).toContainText("알림 끄기 설명이 길어서");
  // 요청자는 큐 대기 동안 정리본을 고칠 수 있고, 회수할 수 있다.
  await expect(summary.getByRole("button", { name: "정리본 고치기" })).toBeVisible();
  await expect(page.getByRole("button", { name: "회수" })).toBeVisible();
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(SCREENS, "task-14-detail.png"), fullPage: true });
});

test("AI를 쓸 수 없는 프로젝트는 검토 버튼 대신 안내 문구가 보인다", async ({ page }) => {
  await login(page, "lead");
  await openNewTicket(page, readSeed().claudeProject.id);
  await expect(page.getByText("이 프로젝트는 AI 검토를 쓸 수 없어요. 바로 제출돼요.")).toBeVisible();
  await expect(page.getByRole("button", { name: "AI 검토 요청" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "바로 제출" })).toBeVisible();
});
