/**
 * 시연 시드의 고정 데이터. 시드 스크립트(scripts/seed-demo.ts)와 시드 전용 가짜 AI 규칙(lib/ai/fake-seed-rules.ts)이
 * 같은 값을 쓴다. 이 파일은 DB·환경 변수에 의존하지 않는다.
 */
export const DEMO_PASSWORD = "demo1234";
export const DEMO_PROJECT_NAME = "Workwrap 샘플";
export const DEMO_REPO_URL = "https://github.com/PorkbellyCode/MyProjectManager-sample-repo";

export type DemoAccount = { key: "lead" | "fe" | "be" | "ai" | "vendor" | "req" | "qa"; email: string; name: string; role: "lead" | "developer" | "requester" };

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { key: "lead", email: "lead@demo.dev", name: "형준", role: "lead" },
  { key: "fe", email: "fe@demo.dev", name: "김프론트", role: "developer" },
  { key: "be", email: "be@demo.dev", name: "이서버", role: "developer" },
  { key: "ai", email: "ai@demo.dev", name: "박에이아이", role: "developer" },
  { key: "vendor", email: "vendor@demo.dev", name: "외주개발사 담당", role: "developer" },
  { key: "req", email: "req@demo.dev", name: "최현업", role: "requester" },
  { key: "qa", email: "qa@demo.dev", name: "정큐에이", role: "requester" },
];

export type DemoGroup = { key: DemoAccount["key"]; name: string; scopeDescription: string; repoTags: string[] };

/** 레포 태그는 인수인계 문서 1절 디렉터리 표의 경로를 쓴다. */
export const DEMO_GROUPS: DemoGroup[] = [
  {
    key: "fe",
    name: "프론트",
    scopeDescription: "대시보드, 요약 시트, 스와이프, PWA 화면",
    repoTags: ["app/dashboard/", "app/summary/", "app/guide", "app/sw.ts", "app/manifest.ts", "components/", "lib/use-swipe.ts"],
  },
  {
    key: "be",
    name: "서버",
    scopeDescription: "API 라우트, DB, 인증, cron",
    repoTags: ["app/api/", "app/login", "lib/db/", "lib/date.ts", "lib/category.ts", "drizzle/", "auth.ts"],
  },
  {
    key: "ai",
    name: "AI 기능",
    scopeDescription: "전사(STT), 요약 프롬프트",
    repoTags: ["lib/summary.ts", "lib/summary-stream.ts"],
  },
  {
    key: "vendor",
    name: "외주개발사",
    scopeDescription: "관리자 화면, 메일",
    repoTags: ["app/admin/", "app/pending"],
  },
];

/** 인수인계 문서 소제목 → 도메인 문서 제목. */
export const DOMAIN_DOC_TITLES = {
  glossary: "용어집",
  format: "요약 결과물의 형식",
  rules: "도메인 규칙(1~13)",
  decisions: "제품 결정과 이유",
  open: "아직 정하지 않은 것",
  states: "사용자 상태 전이",
} as const;

/** 시드 과거 티켓의 제목. 가짜 AI 규칙이 제목으로 시드 티켓을 찾는다. */
export const SEED_TICKET_TITLES = {
  pinned: "메모 '이어가기'가 날짜를 옮겨서 헷갈려요",
  restore: "지운 요약을 되살릴 수 있나요?",
  limit: "요약을 하루에 몇 번까지 만들 수 있나요?",
  dup: "같은 작업 메모가 요약에 두 번 나와요",
} as const;

export const SEED_PINNED_COMMIT = "a69abef";
/** 가짜 레포 정보의 전체 SHA(접두 a69abef). 증거 정규화기는 최신 성공 스냅샷의 커밋만 인정한다. */
export const SEED_PINNED_COMMIT_FULL = "a69abef09fc5b810f4faa333c106b3deba2f6c8f";
