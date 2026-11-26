import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { groups, projects, tickets } from "@/lib/db/schema";
import type { TicketStatus } from "@/lib/db/schema/tickets";
import type { FakeCallContext } from "./fake";
import { SEED_REPO_RULE, SEED_RULES } from "./fake-seed-rules";

/**
 * MPM_FAKE_AI=1일 때의 결정적 응답 규칙(R3). 실제 모델 대신 시스템 지시의 "# 이번 작업" 줄로 역할을 알아내고,
 * 티켓 본문의 키워드로 답을 고른다. 응답은 각 역할의 strict 스키마(tests/ai/schema-portability.test.ts)를 그대로 따르고,
 * 근거·후보는 DB에 실제로 있는 id만 쓴다(정규화기가 없는 id를 지우면 카드가 뜨지 않는다).
 *
 * 규칙은 표(`FAKE_RULES`)로 둔다. 위에서부터 처음 맞는 규칙이 답한다.
 * 시드 전용 규칙(Task 17, `fake-seed-rules.ts`)은 시드 프로젝트에서만 맞아 일반 규칙 앞에 놓인다. 그 밖의 규칙은 `registerFakeRules`로 앞에 끼워 넣는다.
 */

export type FakeTask = "dedup" | "resolve" | "interview" | "recommend" | "summarize" | "repo" | "unknown";

export type FakeInput = {
  task: FakeTask;
  modelId: string;
  system: string;
  user: string;
  ticketId: string | null;
  title: string;
  body: string;
  category: string;
  /** 인터뷰 라운드(인터뷰가 아니면 null) */
  round: number | null;
};

export type FakeHelpers = {
  db: Db;
  /** 검토 중인 티켓의 프로젝트 id(티켓 id로 찾는다). */
  projectId(): Promise<string | null>;
  /** 이 프로젝트에서 제출된(초안·검토 중·철회가 아닌) 티켓, 최근 것부터. 자기 자신은 뺀다. */
  submittedTickets(): Promise<{ id: string; number: number; title: string }[]>;
  /** 검토 중인 티켓의 프로젝트(주소, 데모 여부). */
  project(): Promise<{ id: string; repoUrl: string; isDemo: boolean } | null>;
  /** 이 프로젝트의 그룹, 이름순. */
  groups(): Promise<{ id: string; name: string }[]>;
  sleep(ms: number): Promise<void>;
};

export type FakeRule = {
  name: string;
  task: FakeTask | FakeTask[];
  when?: (input: FakeInput, h: FakeHelpers) => boolean | Promise<boolean>;
  respond: (input: FakeInput, h: FakeHelpers) => unknown | Promise<unknown>;
};

const SUBMITTED: TicketStatus[] = ["queued", "assigned", "in_progress", "on_hold", "resolved", "closed"];

// ---------- 프롬프트 읽기 ----------

type PromptMessage = { role: string; content: unknown };

function textOf(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((part) => (part && typeof part === "object" && "text" in part && typeof part.text === "string" ? part.text : ""))
      .join("\n");
  }
  return "";
}

export function readPrompt(prompt: unknown): { system: string; user: string } {
  const messages = Array.isArray(prompt) ? (prompt as PromptMessage[]) : [];
  const pick = (role: string) =>
    messages
      .filter((m) => m.role === role)
      .map((m) => textOf(m.content))
      .join("\n");
  return { system: pick("system"), user: pick("user") };
}

function taskOf(system: string): FakeTask {
  // 지시사항(관리자가 고친 글)보다 코드가 붙인 마지막 "# 이번 작업" 줄을 믿는다.
  const m = [...system.matchAll(/# 이번 작업: ([^\n(]+)/g)].at(-1);
  const name = m?.[1]?.trim() ?? "";
  if (name.startsWith("중복 확인")) return "dedup";
  if (name.startsWith("해소 확인")) return "resolve";
  if (name.startsWith("인터뷰 질문")) return "interview";
  if (name.startsWith("대상 추천")) return "recommend";
  if (name.startsWith("정리본")) return "summarize";
  if (/레포|repo/i.test(system) && !m) return "repo";
  return "unknown";
}

/** ticketPrompt(lib/review/pipeline)의 모양: 티켓 id, 제목, 분류, 긴급도, 빈 줄, "본문:", 본문, (그 뒤 인터뷰 기록). */
export function toFakeInput(ctx: FakeCallContext): FakeInput {
  const { system, user } = readPrompt(ctx.prompt);
  const line = (label: string) => user.match(new RegExp(`^${label}: (.*)$`, "m"))?.[1]?.trim() ?? "";
  const bodyStart = user.indexOf("본문:\n");
  const rest = bodyStart >= 0 ? user.slice(bodyStart + "본문:\n".length) : "";
  const body = rest.split(/\n## (?:지금까지의 인터뷰|인터뷰 기록)\n/)[0]?.replace(/\n<\/ticket>\s*$/, "") ?? "";
  const round = [...system.matchAll(/라운드 (\d+)\/\d+/g)].at(-1)?.[1];
  return {
    task: taskOf(system),
    modelId: ctx.modelId,
    system,
    user,
    ticketId: line("검토 중인 티켓 id") || null,
    title: line("제목"),
    body,
    category: line("분류"),
    round: round ? Number(round) : null,
  };
}

// ---------- 필요 정보 목록 읽기(시스템 지시에 들어 있다) ----------

type FieldLine = { key: string; label: string; required: boolean; filled: boolean };

/** interviewSystem의 "- key: label (필수|선택, 선호 유형 x)[ — 이미 채워짐]" 줄. */
export function interviewFields(system: string): FieldLine[] {
  const out: FieldLine[] = [];
  for (const m of system.matchAll(/^- ([\w-]+): (.+?) \((필수|선택), 선호 유형 \w+\)( — 이미 채워짐)?$/gm)) {
    out.push({ key: m[1], label: m[2], required: m[3] === "필수", filled: !!m[4] });
  }
  return out;
}

/** summarizeSystem의 "## 필요 정보 key" 아래 "- key: label[ (필수)]" 줄. */
export function summaryKeys(system: string): string[] {
  const section = system.split("## 필요 정보 key")[1] ?? "";
  return [...section.matchAll(/^- ([\w-]+): /gm)].map((m) => m[1]);
}

/** renderAnswered의 "- (라운드 n, key) 질문 → 값[ [첨부 k개]]" 줄. */
export function answeredValues(user: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const m of user.matchAll(/^- \(라운드 \d+, ([\w-]+)\) .*? → (.*?)(?: \[첨부 \d+개\])?$/gm)) {
    out.set(m[1], m[2] === "모르겠어요" ? "알 수 없음" : m[2]);
  }
  return out;
}

const words = (s: string) =>
  new Set(
    s
      .toLowerCase()
      .split(/[^\p{L}\p{N}]+/u)
      .filter((w) => w.length >= 2),
  );

// ---------- 일반 규칙 ----------

/** 본문에 이 낱말이 있으면 검토 단계마다 잠시 멈춘다(검토 진행 화면과 "검토 중 제출"을 결정적으로 보이기 위해). */
export const SLOW_KEYWORD = "천천히";
const SLOW_MS = 5000;

const NONE_DEDUP = { candidates: [] };
const NONE_RESOLVE = { kind: "none", message: "", evidence: [] };

/** 인터뷰 1라운드의 질문 틀. fillsKey는 목록에 맞는 key를 고르고, 없으면 비어 있는 key를 차례로 쓴다. */
const ROUND_ONE = [
  {
    prefer: ["environment", "users", "who_how_often"],
    q: {
      type: "single" as const,
      prompt: "어디서 겪으셨나요?",
      options: ["모바일 앱", "PC 웹", "둘 다"],
      why: "담당 대상을 정하는 데 필요해요",
      justification: null,
    },
  },
  {
    prefer: ["frequency", "who_how_often", "urgency_reason"],
    q: {
      type: "scale" as const,
      prompt: "매번 그런가요?",
      options: ["매번", "가끔", "한 번만"],
      why: "재현할 수 있는지 가늠하려고 해요",
      justification: null,
    },
  },
  {
    prefer: ["screenshot"],
    q: {
      type: "attachment" as const,
      prompt: "문제가 보이는 화면을 캡처해 주실 수 있나요?",
      options: null,
      why: "화면을 보면 위치를 바로 찾을 수 있어요",
      justification: "화면 문제라 글로는 설명이 어려워요",
    },
  },
];

/** 2라운드 글 질문의 문구(기본 필요 정보 key). 목록에 없는 key는 항목 이름으로 묻는다. */
const TEXT_PROMPTS: Record<string, string> = {
  steps: "어떤 순서로 하면 문제가 생기나요?",
  expected: "원래는 어떻게 되어야 하나요?",
  actual: "실제로는 어떻게 되나요?",
  current_pain: "지금 무엇이 가장 불편하신가요?",
  desired: "어떻게 바뀌면 좋을까요?",
  reason: "이 기능이 왜 필요한가요?",
  success_criteria: "어떻게 되면 잘 됐다고 볼 수 있을까요?",
  question: "궁금한 점을 한 문장으로 적어 주세요.",
};

function interviewQuestions(input: FakeInput) {
  const fields = interviewFields(input.system);
  const open = fields.filter((f) => !f.filled);
  const used = new Set<string>();
  const take = (prefer: string[]) => {
    const hit = prefer.map((k) => open.find((f) => f.key === k)).find((f) => f && !used.has(f.key));
    const f = hit ?? open.find((x) => !used.has(x.key));
    if (f) used.add(f.key);
    return f;
  };
  if ((input.round ?? 1) === 1) {
    return ROUND_ONE.flatMap(({ prefer, q }, i) => {
      const f = take(prefer);
      return f ? [{ id: `q${i + 1}`, fillsKey: f.key, ...q }] : [];
    });
  }
  // 2라운드: 아직 비어 있는 필수 항목 하나를 짧은 글로 묻는다.
  const f = open.find((x) => x.required) ?? open[0];
  if (!f) return [];
  return [
    {
      id: "q1",
      fillsKey: f.key,
      type: "text" as const,
      prompt: TEXT_PROMPTS[f.key] ?? `'${f.label}' 항목을 짧게 적어 주세요.`,
      options: null,
      why: "개발자가 되묻지 않고 바로 확인하려고 해요",
      justification: "사람마다 달라서 선택지로 묻기 어려워요",
    },
  ];
}

/** 레포 분석(repo.analyze)의 고정 개요. 그룹 태그는 모두 비워 둔다(리드가 화면에서 단다). */
export const FAKE_REPO_OVERVIEW = {
  stack: ["Next.js", "React", "TypeScript"],
  modules: [
    { path: "lib/summary", summary: "하루 요약을 만드는 로직", groupId: null },
    { path: "app/api/summary", summary: "요약 API", groupId: null },
  ],
  screens: [{ path: "app/summary/page.tsx", name: "오늘 요약", groupId: null }],
  apis: [{ path: "app/api/summary/route.ts", method: "GET", groupId: null }],
  domains: [{ name: "하루 요약", modulePaths: ["lib/summary", "app/api/summary"] }],
};

export const GENERIC_RULES: FakeRule[] = [
  {
    name: "느린 검토(본문에 '천천히')",
    task: ["dedup", "resolve", "interview", "recommend"],
    // 검토가 도는 중의 화면과 "검토 중 제출"을 결정적으로 보이기 위한 지연. 응답은 다음 규칙이 정한다.
    when: async (i, h) => {
      if (i.body.includes(SLOW_KEYWORD)) await h.sleep(SLOW_MS);
      return false;
    },
    respond: () => null,
  },
  {
    name: "중복(본문에 '중복')",
    task: "dedup",
    when: (i) => i.body.includes("중복"),
    respond: async (i, h) => {
      const list = await h.submittedTickets();
      if (list.length === 0) return NONE_DEDUP;
      const mine = words(i.title);
      const hit = list.find((t) => [...words(t.title)].some((w) => mine.has(w))) ?? list[0];
      return {
        candidates: [
          {
            ticketId: hit.id,
            reason: `증상과 화면이 같아 보여요. 이미 #${hit.number} '${hit.title}'로 접수되어 있어요.`,
            differences: "발생 조건은 본문만으로는 확인하지 못했어요.",
          },
        ],
      };
    },
  },
  { name: "중복 없음", task: "dedup", respond: () => NONE_DEDUP },
  // 해소: 일반 규칙은 제안하지 않는다. 시드 전용 규칙(Task 17)이 앞에 들어와 근거 있는 제안을 만든다.
  { name: "해소 없음", task: "resolve", respond: () => NONE_RESOLVE },
  {
    name: "인터뷰(1라운드 3문항, 2라운드 1문항, 그다음 끝)",
    task: "interview",
    respond: (i) => {
      const round = i.round ?? 1;
      if (round > 2) return { done: true, questions: [] };
      const questions = interviewQuestions(i);
      return { done: questions.length === 0, questions };
    },
  },
  {
    name: "추천(이름순 첫 그룹)",
    task: "recommend",
    respond: async (_i, h) => {
      const [first] = await h.groups();
      if (!first) return { target: null, reason: "", evidence: [] };
      return {
        target: { kind: "group", groupId: first.id },
        reason: `'${first.name}' 그룹의 담당 범위와 가장 가까워 보여요.`,
        evidence: [],
      };
    },
  },
  {
    name: "레포 분석(고정 개요)",
    task: "repo",
    respond: () => FAKE_REPO_OVERVIEW,
  },
  {
    name: "정리본(고정 요약)",
    task: "summarize",
    respond: (i) => {
      const answers = answeredValues(i.user);
      const keys = summaryKeys(i.system);
      const firstLine = i.body.split("\n").map((l) => l.trim()).find(Boolean) ?? "";
      const summary = [`'${i.title}' 요청이에요.`, firstLine && `요청자 설명: ${firstLine.slice(0, 120)}`]
        .filter(Boolean)
        .join(" ");
      return {
        summary,
        fields: keys.map((key) => ({ key, value: answers.get(key) ?? null })),
        fillRate: 0,
        urgencyNote: null,
      };
    },
  },
];

const extraRules: FakeRule[] = [];

/** 시드 전용 규칙을 일반 규칙 앞에 넣는다(Task 17). */
export function registerFakeRules(rules: FakeRule[]): void {
  extraRules.unshift(...rules);
}

export function createHelpers(db: Db, input: FakeInput): FakeHelpers {
  let projectId: Promise<string | null> | null = null;
  const getProjectId = () =>
    (projectId ??= input.ticketId
      ? db
          .select({ projectId: tickets.projectId })
          .from(tickets)
          .where(eq(tickets.id, input.ticketId))
          .then((r) => r[0]?.projectId ?? null)
          .catch(() => null)
      : Promise.resolve(null));
  return {
    db,
    projectId: getProjectId,
    async project() {
      const pid = await getProjectId();
      if (!pid) return null;
      const [p] = await db.select({ id: projects.id, repoUrl: projects.repoUrl, isDemo: projects.isDemo }).from(projects).where(eq(projects.id, pid));
      return p ?? null;
    },
    async submittedTickets() {
      const pid = await getProjectId();
      if (!pid) return [];
      return db
        .select({ id: tickets.id, number: tickets.number, title: tickets.title })
        .from(tickets)
        .where(
          and(
            eq(tickets.projectId, pid),
            inArray(tickets.status, SUBMITTED),
            input.ticketId ? ne(tickets.id, input.ticketId) : undefined,
          ),
        )
        .orderBy(desc(tickets.createdAt), desc(tickets.number));
    },
    async groups() {
      const pid = await getProjectId();
      if (!pid) return [];
      return db.select({ id: groups.id, name: groups.name }).from(groups).where(eq(groups.projectId, pid)).orderBy(asc(groups.name));
    },
    sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  };
}

/** 표를 위에서부터 훑어 처음 맞는 규칙의 답을 돌려준다. 맞는 규칙이 없으면 빈 객체. */
export async function respondWithRules(ctx: FakeCallContext, db: Db, rules: FakeRule[] = [...extraRules, ...SEED_RULES, SEED_REPO_RULE, ...GENERIC_RULES]): Promise<unknown> {
  const input = toFakeInput(ctx);
  const h = createHelpers(db, input);
  for (const rule of rules) {
    const tasks = Array.isArray(rule.task) ? rule.task : [rule.task];
    if (!tasks.includes(input.task)) continue;
    if (rule.when && !(await rule.when(input, h))) continue;
    return rule.respond(input, h);
  }
  return {};
}
