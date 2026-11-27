#!/usr/bin/env node
// 배포된 화면이 지금 코드의 CSS를 쓰는지 확인한다(의존성 없음, Node 18+).
// 빌드 캐시가 create-next-app 기본 globals.css를 그대로 내보낸 사고(토큰 클래스 전부 누락)를 잡는다.
//
//   pnpm check:deploy https://example.vercel.app
//   DEPLOY_URL=https://example.vercel.app pnpm check:deploy
//
// 통과 조건: 페이지에 연결된 스타일시트(들)에 --surface, .bg-surface, .mpm-prose가 있고 --font-geist-sans가 없다.

const REQUIRED = ["--surface", ".bg-surface", ".mpm-prose"];
const FORBIDDEN = ["--font-geist-sans"];
// 로그인하지 않아도 열리는 화면(앱 셸과 같은 globals.css를 쓴다).
const DEFAULT_PATH = "/login";

function fail(msg) {
  console.error(`✗ ${msg}`);
  process.exit(1);
}

const raw = process.argv[2] ?? process.env.DEPLOY_URL;
if (!raw) fail("확인할 주소를 인자나 DEPLOY_URL로 주세요. 예: pnpm check:deploy https://myapp.vercel.app");

let page;
try {
  page = new URL(raw);
} catch {
  fail(`주소가 올바르지 않아요: ${raw}`);
}
if (page.pathname === "/" || page.pathname === "") page.pathname = DEFAULT_PATH;

/** 본문과 최종 주소(리다이렉트 뒤). 상대 경로는 최종 주소 기준으로 푼다. */
async function get(url) {
  const res = await fetch(url, { redirect: "follow", headers: { "user-agent": "mpm-check-deploy" } });
  if (res.status === 401 || res.status === 403) {
    throw new Error(
      `${url} → HTTP ${res.status}. 배포 보호(Vercel Deployment Protection)가 켜져 있을 수 있어요. ` +
        "프로덕션 주소로 확인하거나, 보호 우회 토큰을 붙인 주소(?x-vercel-protection-bypass=…)를 주세요.",
    );
  }
  if (!res.ok) throw new Error(`${url} → HTTP ${res.status}`);
  return { text: await res.text(), url: res.url || url };
}

/** <link ... rel="stylesheet" ... href="..."> 의 href(속성 순서 무관). */
function stylesheetHrefs(html, base) {
  const out = new Set();
  for (const [tag] of html.matchAll(/<link\b[^>]*>/gi)) {
    if (!/\brel\s*=\s*["']?stylesheet\b/i.test(tag)) continue;
    const href = tag.match(/\bhref\s*=\s*["']([^"']+)["']/i)?.[1];
    if (href) out.add(new URL(href.replace(/&amp;/g, "&"), base).href);
  }
  return [...out];
}

try {
  const { text: html, url: finalUrl } = await get(page.href);
  const hrefs = stylesheetHrefs(html, finalUrl);
  if (hrefs.length === 0) fail(`${page.href}에서 연결된 스타일시트를 찾지 못했어요.`);
  const css = (await Promise.all(hrefs.map(async (h) => (await get(h)).text))).join("\n");

  const missing = REQUIRED.filter((s) => !css.includes(s));
  const stale = FORBIDDEN.filter((s) => css.includes(s));
  console.log(`페이지: ${finalUrl}`);
  for (const h of hrefs) console.log(`  스타일시트: ${h}`);
  if (missing.length || stale.length) {
    if (missing.length) console.error(`✗ 있어야 할 것이 빠졌어요: ${missing.join(", ")}`);
    if (stale.length) console.error(`✗ 예전(create-next-app 기본) CSS 흔적이 있어요: ${stale.join(", ")}`);
    fail("배포된 CSS가 지금 코드와 달라요. 빌드 캐시 없이 다시 배포해 주세요(Vercel: Redeploy → 'Use existing Build Cache' 끄기).");
  }
  console.log(`✓ 디자인 토큰과 편집기 스타일이 배포돼 있어요 (${REQUIRED.join(", ")}).`);
} catch (e) {
  fail(e instanceof Error ? e.message : String(e));
}
