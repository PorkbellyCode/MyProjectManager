import path from "node:path";
import { expect, test, type Browser, type BrowserContext, type Page } from "@playwright/test";
import { DEMO_ACCOUNTS, DEMO_PASSWORD, SEED_TICKET_TITLES } from "@/lib/demo/seed-data";
import { sampleProjectId } from "./fixtures/seed";

// 시연 전체 흐름. 시드(`seedDemo`, `pnpm seed:demo`와 같은 코드)가 만든 "Workwrap 샘플" 프로젝트에서
// MPM_FAKE_AI=1의 시드 전용 규칙(lib/ai/fake-seed-rules.ts)으로 AI 검토가 결정적으로 흐른다.
const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");
const AI_WAIT = { timeout: 30_000 };
type Who = "lead" | "ai" | "req" | "qa";

test.use({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
test.describe.configure({ mode: "serial", timeout: 180_000 });

const account = (who: Who) => DEMO_ACCOUNTS.find((a) => a.key === who)!;

async function login(page: Page, who: Who) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(account(who).email);
  await page.getByLabel("비밀번호").fill(DEMO_PASSWORD);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
}

async function as(browser: Browser, who: Who): Promise<{ ctx: BrowserContext; page: Page }> {
  const ctx = await browser.newContext({ colorScheme: "light", viewport: { width: 1440, height: 1000 } });
  const page = await ctx.newPage();
  await login(page, who);
  return { ctx, page };
}

const ticketStatus = (page: Page) => page.getByRole("status", { name: "티켓 상태" });
const panel = (page: Page) => page.getByRole("region", { name: "처리" });
const activity = (page: Page) => page.getByRole("region", { name: "활동" });

async function shot(page: Page, name: string) {
  await page.waitForTimeout(600); // 등장 애니메이션이 끝난 뒤 찍는다(스크린샷 전용)
  await page.screenshot({ path: path.join(SCREENS, name), fullPage: true });
}

async function writeTicket(page: Page, input: { title: string; body: string }) {
  await page.goto(`/p/${await sampleProjectId()}/tickets/new`);
  await expect(page.getByRole("heading", { name: "새 티켓" })).toBeVisible();
  await page.getByRole("textbox", { name: "제목" }).fill(input.title);
  const body = page.getByRole("textbox", { name: "본문" });
  await body.click();
  await page.keyboard.type(input.body);
  await page.getByRole("button", { name: "AI 검토 요청" }).click();
  await page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);
  return page.url().split("/").at(-1)!;
}

let firstTicketId = "";

test("① 요청자 → AI 검토(질문 2라운드, 추천 AI 기능) → 제출 → 개발자가 큐에서 가져가 댓글·처리 완료 → 요청자 확인 → 종결", async ({ browser }) => {
  const req = await as(browser, "req");
  firstTicketId = await writeTicket(req.page, { title: "요약 결과가 이상해요", body: "어제 메모로 요약을 만들었는데 오늘 한 일이 기대와 다르게 정리돼요." });

  // 중복·해소 카드 없이 질문 라운드 1/2 (질문 3개)
  const round1 = req.page.getByRole("region", { name: "질문 라운드 1/2" });
  await expect(round1).toBeVisible(AI_WAIT);
  await expect(req.page.getByRole("region", { name: "중복 확인 결과" })).toHaveCount(0);
  await expect(req.page.getByRole("region", { name: "해소 확인 결과" })).toHaveCount(0);
  await round1.getByRole("radiogroup", { name: "어디서 겪으셨나요?" }).getByRole("radio", { name: "모바일 앱" }).click();
  await round1.getByRole("radiogroup", { name: "매번 그런가요?" }).getByRole("radio", { name: "가끔" }).click();
  await round1.getByRole("button", { name: "답변 보내기" }).click();

  // 질문 라운드 2/2 (질문 1개)
  const round2 = req.page.getByRole("region", { name: "질문 라운드 2/2" });
  await expect(round2).toBeVisible(AI_WAIT);
  await round2.getByRole("textbox", { name: "어떤 순서로 하면 문제가 생기나요?" }).fill("요약 시트에서 어제 메모를 모두 골라 요약하기를 눌러요");
  await round2.getByRole("button", { name: "답변 보내기" }).click();

  // 준비 카드: 추천 그룹 "AI 기능"을 확인하고 제출
  const ready = req.page.getByRole("region", { name: "제출 준비" });
  await expect(ready).toBeVisible(AI_WAIT);
  await expect(ready.getByRole("combobox", { name: "담당 대상" })).toContainText("AI 기능");
  await expect(ready.getByText("'AI 기능' 그룹")).toBeVisible();
  await ready.getByRole("button", { name: "제출", exact: true }).click();
  await expect(ticketStatus(req.page)).toHaveText("큐 대기");

  // ai(박에이아이): 그룹 큐에서 가져가기 → 정리본의 긴급도 참고 → 댓글
  const ai = await as(browser, "ai");
  await ai.page.goto(`/p/${await sampleProjectId()}/tickets?view=group`);
  await ai.page.getByRole("table", { name: "티켓 목록" }).getByRole("link", { name: "요약 결과가 이상해요" }).click();
  await expect(ticketStatus(ai.page)).toHaveText("큐 대기");
  await panel(ai.page).getByRole("button", { name: "가져가기" }).click();
  await expect(ticketStatus(ai.page)).toHaveText("진행중");
  await expect(ai.page.getByRole("region", { name: "정리본" }).getByText("비슷한 티켓은 주로 '보통'이었어요")).toBeVisible(AI_WAIT);

  const box = ai.page.getByRole("textbox", { name: "댓글" });
  await box.click();
  await ai.page.keyboard.type("같은 메모를 묶는 요약 프롬프트 규칙을 확인하고 있어요.");
  await ai.page.getByRole("button", { name: "댓글 남기기" }).click();
  await expect(activity(ai.page).getByText("요약 프롬프트 규칙을 확인하고 있어요")).toBeVisible();

  // 요청자: 알림(새 댓글)
  await req.page.goto("/notifications");
  const note = req.page.getByRole("link", { name: /요약 결과가 이상해요/ }).filter({ hasText: "새 댓글이 있어요" }).first();
  await expect(note).toBeVisible();
  await note.click();
  await req.page.waitForURL(/\/tickets\/[0-9a-f-]{36}$/);

  // ai: 처리 완료(PR 번호) → 요청자 고쳐졌어요 → 종결
  await panel(ai.page).getByRole("button", { name: "처리 완료" }).click();
  const resolve = ai.page.getByRole("dialog", { name: "처리 완료로 표시할까요?" });
  await resolve.getByRole("textbox", { name: "PR 번호" }).fill("42");
  await resolve.getByRole("button", { name: "처리 완료하기" }).click();
  await expect(ticketStatus(ai.page)).toHaveText("확인 대기");

  await req.page.reload();
  const confirm = req.page.getByRole("region", { name: "처리 확인" });
  await expect(confirm.getByRole("link", { name: /PR #42/ })).toBeVisible();
  await confirm.getByRole("button", { name: "고쳐졌어요" }).click();
  await expect(ticketStatus(req.page)).toHaveText("종결");

  await ai.ctx.close();
  await req.ctx.close();
});

test("② 요청자 '이어가기' → 해소 카드(이미 해결됨, 종결 티켓·커밋 근거) → 해결됐어요 → 철회(AI 해소)", async ({ browser }) => {
  const req = await as(browser, "req");
  await writeTicket(req.page, { title: "메모 이어가기 버튼이 없어졌어요", body: "예전에 메모마다 있던 이어가기 버튼이 안 보여요." });

  const card = req.page.getByRole("region", { name: "해소 확인 결과" });
  await expect(card).toBeVisible(AI_WAIT);
  await expect(card.getByText("이미 해결됨", { exact: true })).toBeVisible();
  // 근거: 시드의 종결 티켓(상세로 가는 링크)과 커밋(GitHub 링크)
  await expect(card.getByRole("link", { name: new RegExp(SEED_TICKET_TITLES.pinned.slice(0, 8)) })).toHaveAttribute("href", /\/tickets\/[0-9a-f-]{36}$/);
  await expect(card.getByRole("link", { name: /a69abef/ })).toHaveAttribute("href", /github\.com\/PorkbellyCode\/MyProjectManager-sample-repo\/commit\/a69abef/);
  await shot(req.page, "task-17-already-resolved.png");

  await card.getByRole("button", { name: "해결됐어요" }).click();
  await expect(ticketStatus(req.page)).toHaveText("철회(AI 해소)");
  await req.ctx.close();
});

test("③ 큐에이 '버전 비어 있음' → 해소 카드(정상 동작, 도메인 규칙 근거) → 그대로 제출 → 리드 큐 → 상세 타임라인", async ({ browser }) => {
  const qa = await as(browser, "qa");
  const id = await writeTicket(qa.page, { title: "요약 버전이 v1, v3으로 비어 있어요", body: "요약 이력을 보니 v2가 없고 v1, v3만 있어요. 오류인가요?" });

  const card = qa.page.getByRole("region", { name: "해소 확인 결과" });
  await expect(card).toBeVisible(AI_WAIT);
  await expect(card.getByText("정상 동작", { exact: true })).toBeVisible();
  await expect(card.getByText("v1, v3처럼 번호가 비는 것이 정상이에요")).toBeVisible();
  await expect(card.getByRole("link", { name: /도메인 지식/ })).toHaveAttribute("href", /\/repo\?doc=[0-9a-f-]{36}$/);
  await shot(qa.page, "task-17-expected-behavior.png");

  await card.getByRole("button", { name: "그대로 제출" }).click();
  await expect(ticketStatus(qa.page)).toHaveText("큐 대기");
  await expect(qa.page.getByRole("complementary", { name: "티켓 정보" }).getByText("리드 큐")).toBeVisible();

  // 리드: 리드 큐에 있고, 첫 티켓의 타임라인에 검토 턴·판단·배정·댓글·종결이 모두 있다
  const lead = await as(browser, "lead");
  const projectId = await sampleProjectId();
  await lead.page.goto(`/p/${projectId}/tickets?view=lead`);
  await expect(lead.page.getByRole("table", { name: "티켓 목록" }).getByRole("link", { name: "요약 버전이 v1, v3으로 비어 있어요" })).toBeVisible();
  expect(id).toMatch(/^[0-9a-f-]{36}$/);

  await lead.page.goto(`/p/${projectId}/tickets/${firstTicketId}`);
  await expect(ticketStatus(lead.page)).toHaveText("종결");
  const log = activity(lead.page);
  await expect(log.getByText("라운드 1 질문 3개를 드렸어요")).toBeVisible();
  await expect(log.getByText("라운드 2 질문 1개를 드렸어요")).toBeVisible();
  await expect(log.getByText("맡을 곳을 추천했어요 · AI 기능 그룹")).toBeVisible();
  await expect(log.getByText(/중복 확인.* 판단을 마쳤어요/)).toBeVisible();
  await expect(log.getByText(/인터뷰 라운드 1 판단을 마쳤어요/)).toBeVisible();
  await expect(log.getByText("Claude").first()).toBeVisible();
  await expect(log.getByText(/제출했어요 → AI 기능 그룹/)).toBeVisible();
  await expect(log.getByText("가져갔어요")).toBeVisible();
  await expect(log.getByText("요약 프롬프트 규칙을 확인하고 있어요")).toBeVisible();
  await expect(log.getByText("처리 완료했어요")).toBeVisible();
  await expect(log.getByText("해결됐다고 확인했어요")).toBeVisible();
  await shot(lead.page, "task-17-timeline.png");

  await lead.page.goto(`/p/${projectId}/tickets?view=all`);
  await expect(lead.page.getByRole("table", { name: "티켓 목록" }).getByRole("link", { name: SEED_TICKET_TITLES.dup })).toBeVisible();
  await shot(lead.page, "task-17-demo-list.png");

  await lead.ctx.close();
  await qa.ctx.close();
});
