import path from "node:path";
import zlib from "node:zlib";
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readSeed } from "./fixtures/seed";

const SCREENS = path.resolve(__dirname, "../.superpowers/sdd/2026-11-24-mpm-phase1/screens");

test.use({ colorScheme: "light" });

/** 외부 의존 없이 만드는 작은 PNG(가로 그라데이션). */
function makePng(w = 240, h = 140): number[] {
  const crcTable = Array.from({ length: 256 }, (_, n) => {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    return c >>> 0;
  });
  const crc = (buf: Buffer) => {
    let c = 0xffffffff;
    for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
    return (c ^ 0xffffffff) >>> 0;
  };
  const chunk = (type: string, data: Buffer) => {
    const len = Buffer.alloc(4);
    len.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type), data]);
    const sum = Buffer.alloc(4);
    sum.writeUInt32BE(crc(body));
    return Buffer.concat([len, body, sum]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;
  ihdr[9] = 2; // RGB
  const raw = Buffer.alloc((w * 3 + 1) * h);
  for (let y = 0; y < h; y++) {
    const row = y * (w * 3 + 1);
    for (let x = 0; x < w; x++) {
      raw[row + 1 + x * 3] = Math.round((x / w) * 255);
      raw[row + 2 + x * 3] = Math.round((y / h) * 200);
      raw[row + 3 + x * 3] = 160;
    }
  }
  return [
    ...Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", ihdr),
      chunk("IDAT", zlib.deflateSync(raw)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  ];
}
const PNG = makePng();

async function login(page: Page, who: "lead" | "dev" = "lead") {
  const seed = readSeed();
  await page.goto("/login");
  await page.getByLabel("이메일").fill(seed[who].email);
  await page.getByLabel("비밀번호").fill(seed.password);
  await page.getByRole("button", { name: "로그인" }).click();
  await page.waitForURL(/\/p\/.+\/tickets/);
}

async function openEditor(page: Page, projectId = readSeed().claudeProject.id) {
  await page.goto(`/editor-playground?project=${projectId}`);
  const editor = page.getByRole("textbox", { name: "요청 내용" });
  await expect(editor).toBeVisible();
  return editor;
}

// 클립보드/드래그로 파일이 들어오는 상황을 브라우저 안에서 그대로 만든다.
async function pasteImage(page: Page) {
  await page.getByRole("textbox", { name: "요청 내용" }).click();
  await page.evaluate((bytes) => {
    const dt = new DataTransfer();
    dt.items.add(new File([new Uint8Array(bytes)], "image.png", { type: "image/png" }));
    const el = document.querySelector(".ProseMirror")!;
    el.dispatchEvent(new ClipboardEvent("paste", { clipboardData: dt, bubbles: true, cancelable: true }));
  }, PNG);
}
async function dropImage(page: Page) {
  const box = (await page.getByRole("textbox", { name: "요청 내용" }).boundingBox())!;
  await page.evaluate(
    ({ bytes, x, y }) => {
      const dt = new DataTransfer();
      dt.items.add(new File([new Uint8Array(bytes)], "화면.png", { type: "image/png" }));
      const el = document.querySelector(".ProseMirror")!;
      el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, clientX: x, clientY: y, bubbles: true, cancelable: true }));
    },
    { bytes: PNG, x: box.x + 20, y: box.y + 20 },
  );
}

const FILE_URL = /^\/api\/files\/projects\/[^/]+\/\d{4}\/[0-9a-f-]{36}\.png$/;

async function expectUploaded(page: Page) {
  const img = page.locator(".ProseMirror img");
  await expect(img).toHaveCount(1);
  await expect(img).toHaveAttribute("src", FILE_URL);
  await expect(img).not.toHaveAttribute("data-status", /.+/);
  // 실제로 불러와졌는지(로그인한 멤버에게 200 + 이미지)
  await expect.poll(() => img.evaluate((el: HTMLImageElement) => el.complete && el.naturalWidth)).toBe(240);
  const src = (await img.getAttribute("src"))!;
  const res = await page.request.get(src);
  expect(res.status()).toBe(200);
  expect(res.headers()["content-type"]).toBe("image/png");
  expect(res.headers()["cache-control"]).toContain("private");
  return src;
}

test("붙여넣은 PNG는 미리보기로 보이다가 업로드 후 /api/files 주소로 바뀐다", async ({ page }) => {
  await login(page);
  // 업로드를 잠깐 붙잡아 '업로드 중' 상태를 확인한다.
  let release!: () => void;
  const gate = new Promise<void>((r) => (release = r));
  await page.route("**/api/uploads", async (route) => {
    await gate;
    await route.continue();
  });
  await openEditor(page);
  await pasteImage(page);

  const img = page.locator(".ProseMirror img");
  await expect(img).toHaveAttribute("src", /^blob:/);
  await expect(img).toHaveAttribute("data-status", "uploading");
  await expect(img).toHaveAttribute("data-upload-id", /.+/);
  await expect(page.getByRole("button", { name: "제출" })).toBeDisabled();
  await expect(page.getByTestId("markdown-output")).not.toContainText("blob:");
  await expect(page.getByRole("status")).toContainText("업로드 중");

  release();
  const src = await expectUploaded(page);
  await expect(page.getByRole("button", { name: "제출" })).toBeEnabled();
  await expect(page.getByTestId("markdown-output")).toContainText(`](${src})`);
  await expect(page.getByTestId("markdown-output")).not.toContainText("blob:");
  await expect(page.getByRole("status")).toContainText("이미지를 올렸어요");

  await page.screenshot({ path: path.join(SCREENS, "task-13-editor.png"), fullPage: true });
});

test("드래그 앤 드롭한 PNG도 업로드 후 실제 주소가 된다", async ({ page }) => {
  await login(page);
  await openEditor(page);
  await dropImage(page);
  const src = await expectUploaded(page);
  await expect(page.getByTestId("markdown-output")).toContainText(`![화면](${src})`);
});

test("업로드가 실패하면 '업로드 실패, 다시 시도'가 보이고 누르면 다시 올린다", async ({ page }) => {
  await login(page);
  let calls = 0;
  await page.route("**/api/uploads", async (route) => {
    calls += 1;
    if (calls === 1) return route.abort("failed");
    return route.continue();
  });
  await openEditor(page);
  await pasteImage(page);

  const img = page.locator(".ProseMirror img");
  await expect(img).toHaveAttribute("data-status", "failed");
  const retry = page.getByRole("button", { name: "업로드 실패, 다시 시도" });
  await expect(retry).toBeVisible();
  await expect(page.getByTestId("markdown-output")).not.toContainText("blob:");
  await expect(page.getByRole("button", { name: "제출" })).toBeEnabled();

  await retry.click();
  await expectUploaded(page);
  expect(calls).toBe(2);
});

test("서식 버튼에는 이름이 있고 편집기에는 접근 가능한 이름이 있다", async ({ page }) => {
  await login(page);
  const editor = await openEditor(page);
  await expect(editor).toHaveAttribute("aria-multiline", "true");
  const toolbar = page.getByRole("toolbar", { name: "서식" });
  for (const name of ["굵게", "기울임", "제목", "글머리 목록", "번호 목록", "인용", "코드", "코드 블록", "이미지 첨부"]) {
    await expect(toolbar.getByRole("button", { name, exact: true })).toBeVisible();
  }
  await toolbar.getByRole("button", { name: "굵게" }).click();
  await expect(toolbar.getByRole("button", { name: "굵게" })).toHaveAttribute("aria-pressed", "true");
});

test("파일 선택 버튼으로도 올릴 수 있다", async ({ page }) => {
  await login(page);
  await openEditor(page);
  await page.getByTestId("editor-file-input").setInputFiles({ name: "shot.png", mimeType: "image/png", buffer: Buffer.from(PNG) });
  await expectUploaded(page);
});

test("업로드한 파일은 프로젝트 멤버만 볼 수 있다", async ({ browser, request }) => {
  const seed = readSeed();
  // 리드만 속한 Gemini 프로젝트에 올린다.
  const leadCtx = await browser.newContext();
  const leadPage = await leadCtx.newPage();
  await login(leadPage, "lead");
  const up = await leadPage.request.post("/api/uploads", {
    multipart: { projectId: seed.geminiProject.id, file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from(PNG) } },
  });
  expect(up.status()).toBe(201);
  const { url } = (await up.json()) as { url: string };
  expect(url).toMatch(FILE_URL);
  expect((await leadPage.request.get(url)).status()).toBe(200);

  // 로그인하지 않으면 401
  expect((await request.get(url)).status()).toBe(401);

  // 다른 프로젝트 멤버(개발자)는 404, 업로드도 404
  const devCtx: BrowserContext = await browser.newContext();
  const devPage = await devCtx.newPage();
  await login(devPage, "dev");
  expect((await devPage.request.get(url)).status()).toBe(404);
  const denied = await devPage.request.post("/api/uploads", {
    multipart: { projectId: seed.geminiProject.id, file: { name: "a.png", mimeType: "image/png", buffer: Buffer.from(PNG) } },
  });
  expect(denied.status()).toBe(404);
  const notImage = await devPage.request.post("/api/uploads", {
    multipart: { projectId: seed.claudeProject.id, file: { name: "a.txt", mimeType: "text/plain", buffer: Buffer.from("hi") } },
  });
  expect(notImage.status()).toBe(415);
  await leadCtx.close();
  await devCtx.close();
});
