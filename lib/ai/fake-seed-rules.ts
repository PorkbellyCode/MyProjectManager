import { and, eq } from "drizzle-orm";
import { domainDocs, tickets } from "@/lib/db/schema";
import {
  DEMO_REPO_URL,
  DOMAIN_DOC_TITLES,
  SEED_PINNED_COMMIT,
  SEED_TICKET_TITLES,
} from "@/lib/demo/seed-data";
import type { FakeHelpers, FakeInput, FakeRule } from "./fake-rules";

/**
 * 시연 시드 전용 규칙(Task 17). 시드 프로젝트(Workwrap 샘플, 샘플 레포 주소)의 티켓에서만 맞고,
 * 다른 프로젝트(E2E의 다른 데모 등)에서는 일반 규칙이 그대로 답한다. 근거는 시드가 만든 실제 id만 쓴다.
 */

async function inSeedProject(h: FakeHelpers): Promise<boolean> {
  const p = await h.project();
  return !!p && p.isDemo && p.repoUrl === DEMO_REPO_URL;
}

async function seedTicketId(h: FakeHelpers, title: string): Promise<string | null> {
  const projectId = await h.projectId();
  if (!projectId) return null;
  const [row] = await h.db
    .select({ id: tickets.id })
    .from(tickets)
    .where(and(eq(tickets.projectId, projectId), eq(tickets.title, title)));
  return row?.id ?? null;
}

async function seedDocId(h: FakeHelpers, title: string): Promise<string | null> {
  const projectId = await h.projectId();
  if (!projectId) return null;
  const [row] = await h.db
    .select({ id: domainDocs.id })
    .from(domainDocs)
    .where(and(eq(domainDocs.projectId, projectId), eq(domainDocs.title, title)));
  return row?.id ?? null;
}

const text = (i: FakeInput) => `${i.title}\n${i.body}`;

const isContinueTicket = (i: FakeInput) => text(i).includes("이어가기");
const isVersionGapTicket = (i: FakeInput) => text(i).includes("버전") && text(i).includes("비어");

export const SEED_RULES: FakeRule[] = [
  {
    name: "시드: 중복(본문에 '중복') → 진행 중인 시드 티켓",
    task: "dedup",
    when: async (i, h) => text(i).includes("중복") && (await inSeedProject(h)) && !!(await seedTicketId(h, SEED_TICKET_TITLES.dup)),
    respond: async (_i, h) => {
      const id = (await seedTicketId(h, SEED_TICKET_TITLES.dup))!;
      return {
        candidates: [
          {
            ticketId: id,
            reason: "같은 증상으로 이미 AI 기능 그룹이 처리 중인 티켓이에요.",
            differences: "발생 조건은 본문만으로는 확인하지 못했어요.",
          },
        ],
      };
    },
  },
  {
    name: "시드: 해소(이어가기) → 이미 해결됨(종결 티켓 + 커밋)",
    task: "resolve",
    when: async (i, h) => isContinueTicket(i) && (await inSeedProject(h)) && !!(await seedTicketId(h, SEED_TICKET_TITLES.pinned)),
    respond: async (_i, h) => {
      const id = (await seedTicketId(h, SEED_TICKET_TITLES.pinned))!;
      return {
        kind: "already_resolved",
        message: "메모 '이어가기'는 날짜를 옮기는 문제가 있어 '고정하기'로 바뀌었어요. 같은 자리에 있는 '고정' 버튼을 써 보세요.",
        evidence: [
          { ref: `ticket:${id}`, note: "'이어가기'를 '고정하기'로 바꾼 종결 티켓" },
          { ref: `commit:${SEED_PINNED_COMMIT}`, note: "이어가기 → 고정하기 변경" },
        ],
      };
    },
  },
  {
    name: "시드: 해소(버전, 비어) → 정상 동작(도메인 규칙 8)",
    task: "resolve",
    when: async (i, h) => isVersionGapTicket(i) && (await inSeedProject(h)) && !!(await seedDocId(h, DOMAIN_DOC_TITLES.rules)),
    respond: async (_i, h) => {
      const id = (await seedDocId(h, DOMAIN_DOC_TITLES.rules))!;
      return {
        kind: "expected_behavior",
        message: "버전 번호는 한번 붙으면 바뀌지 않아요. 중간 버전을 지웠다면 v1, v3처럼 번호가 비는 것이 정상이에요.",
        evidence: [{ ref: `doc:${id}`, note: "도메인 규칙 8: 버전 번호는 한번 붙으면 바뀌지 않는다" }],
      };
    },
  },
  {
    name: "시드: 추천(AI 기능 그룹)",
    task: "recommend",
    when: (_i, h) => inSeedProject(h),
    respond: async (_i, h) => {
      const g = (await h.groups()).find((x) => x.name === "AI 기능");
      if (!g) return { target: null, reason: "", evidence: [] };
      return {
        target: { kind: "group", groupId: g.id },
        reason: "요약 결과의 품질은 요약 프롬프트를 맡은 'AI 기능' 그룹의 범위예요.",
        evidence: [],
      };
    },
  },
  {
    name: "시드: 정리본(고정 정리본 + 긴급도 참고)",
    task: "summarize",
    when: (_i, h) => inSeedProject(h),
    respond: async (i) => {
      const keys = [...(i.system.split("## 필요 정보 key")[1] ?? "").matchAll(/^- ([\w-]+): /gm)].map((m) => m[1]);
      const answered = new Map<string, string>();
      for (const m of i.user.matchAll(/^- \(라운드 \d+, ([\w-]+)\) .*? → (.*?)(?: \[첨부 \d+개\])?$/gm)) {
        answered.set(m[1], m[2] === "모르겠어요" ? "알 수 없음" : m[2]);
      }
      return {
        summary: `'${i.title}' 요청이에요. 요약 결과가 기대와 달라 개발자의 확인이 필요해요.`,
        fields: keys.map((key) => ({ key, value: answered.get(key) ?? null })),
        fillRate: 0,
        urgencyNote: "비슷한 티켓은 주로 '보통'이었어요",
      };
    },
  },
];

type GroupLine = { id: string; name: string };

/** 레포 분석 요청(buildPrompt)의 "- id: … / 이름: …" 줄에서 그룹을 읽는다. */
function promptGroups(user: string): GroupLine[] {
  return [...user.matchAll(/^- id: (\S+) \/ 이름: (.+?) \/ 담당 범위:/gm)].map((m) => ({ id: m[1], name: m[2] }));
}

/** 샘플 레포 분석인지: 요청에 실린 레포 이름과 그룹 이름으로 알아본다. */
function isSeedRepoPrompt(i: FakeInput): boolean {
  if (!i.user.includes("MyProjectManager-sample-repo")) return false;
  const names = new Set(promptGroups(i.user).map((g) => g.name));
  return ["프론트", "서버", "AI 기능", "외주개발사"].every((n) => names.has(n));
}

/** 시드 레포(Workwrap) 고정 개요. 도메인 맵은 인수인계 문서 2절의 용어와 1절 디렉터리 표를 따른다. */
export function seedRepoOverview(user: string) {
  const id = (name: string) => promptGroups(user).find((g) => g.name === name)?.id ?? null;
  const fe = id("프론트");
  const be = id("서버");
  const ai = id("AI 기능");
  const vendor = id("외주개발사");
  return {
    stack: ["Next.js 16", "React 19", "TypeScript", "Tailwind CSS v4", "Drizzle ORM", "Neon Postgres", "Auth.js", "OpenAI"],
    modules: [
      { path: "lib/summary.ts", summary: "요약 모델 선택, 프롬프트 조립, 하루 상한 설정(서버 전용)", groupId: ai },
      { path: "lib/summary-stream.ts", summary: "요약 SSE 응답 파서", groupId: ai },
      { path: "lib/use-swipe.ts", summary: "날짜 스와이프 제스처 훅", groupId: fe },
      { path: "lib/date.ts", summary: "KST 날짜 유틸", groupId: be },
      { path: "lib/db", summary: "Drizzle 스키마와 쿼리", groupId: be },
      { path: "auth.ts", summary: "Auth.js 설정과 세션 콜백", groupId: be },
      { path: "components", summary: "상단 내비, 탭 바, 요약 렌더러, 설치 배너", groupId: fe },
    ],
    screens: [
      { path: "app/dashboard", name: "대시보드(메모 타임라인, 녹음, 요약 시트)", groupId: fe },
      { path: "app/summary", name: "요약 버전 이력과 배경 정보 편집", groupId: fe },
      { path: "app/admin", name: "관리자(사용량 통계, 사용자 승인)", groupId: vendor },
      { path: "app/pending", name: "승인 대기와 이용 신청", groupId: vendor },
    ],
    apis: [
      { path: "app/api/transcribe", method: "POST", groupId: ai },
      { path: "app/api/summaries", method: "POST", groupId: ai },
      { path: "app/api/memos", method: "GET", groupId: be },
      { path: "app/api/cron/purge-summaries", method: "GET", groupId: be },
    ],
    domains: [
      { name: "메모 기록", modulePaths: ["app/dashboard", "app/api/memos", "lib/date.ts", "lib/use-swipe.ts"] },
      { name: "전사", modulePaths: ["app/api/transcribe"] },
      { name: "요약", modulePaths: ["lib/summary.ts", "lib/summary-stream.ts", "app/api/summaries", "app/summary"] },
      { name: "사용자 상태와 인증", modulePaths: ["auth.ts", "app/pending", "app/admin"] },
    ],
  };
}

export const SEED_REPO_RULE: FakeRule = {
  name: "시드: 레포 분석(고정 개요 + 도메인 맵)",
  task: "repo",
  when: (i) => isSeedRepoPrompt(i),
  respond: (i) => seedRepoOverview(i.user),
};
