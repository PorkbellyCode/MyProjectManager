import { z } from "zod";
import type { Category } from "@/lib/db/schema/tickets";

export const MAX_ROUNDS = 2;
export const MAX_QUESTIONS_PER_ROUND = 3;

/** 표시할 때 single/multi/scale 질문에 항상 덧붙이는 선택지. 저장하는 질문에는 넣지 않는다. */
export const OTHER_OPTION = "직접 입력";
export const UNKNOWN_OPTION = "모르겠어요";
/** 응답에 저장하는 "모르겠어요" 값. 채운 것으로 보고 다시 묻지 않는다. */
export const UNKNOWN_VALUE = "unknown";

export type QuestionType = "single" | "multi" | "scale" | "text" | "attachment";
const QUESTION_TYPES = ["single", "multi", "scale", "text", "attachment"] as const;

export type RequiredField = { key: string; label: string; required: boolean; preferredType: QuestionType };

const f = (key: string, label: string, required: boolean, preferredType: QuestionType): RequiredField => ({
  key,
  label,
  required,
  preferredType,
});

/**
 * 카테고리별 필요 정보 목록. 항목과 순서는 인터뷰 설계 4.1 표 그대로다.
 * 표에는 필수 여부가 없어서(관리자가 고치는 값), 개발자가 바로 일하려면 꼭 있어야 하는 항목만 필수로 둔다.
 */
export const DEFAULT_REQUIRED_FIELDS: Record<Category, RequiredField[]> = {
  defect: [
    f("steps", "재현 순서", true, "text"),
    f("expected", "기대 결과", true, "text"),
    f("actual", "실제 결과", true, "text"),
    f("environment", "환경(기기·브라우저·앱 버전)", true, "single"),
    f("frequency", "빈도", false, "scale"),
    f("impact", "영향 범위", false, "single"),
    f("screenshot", "스크린샷", false, "attachment"),
  ],
  improvement: [
    f("current_pain", "현재 불편", true, "text"),
    f("desired", "원하는 모습", true, "text"),
    f("who_how_often", "누가·얼마나 자주 겪는지", false, "single"),
    f("workaround", "지금 쓰는 우회 방법", false, "single"),
  ],
  feature: [
    f("reason", "필요한 이유", true, "text"),
    f("users", "쓰는 사람", true, "single"),
    f("success_criteria", "성공 기준", true, "text"),
    f("urgency_reason", "급한 정도와 이유", false, "single"),
  ],
  inquiry: [f("question", "질문 내용", true, "text")],
};

export type Question = {
  id: string;
  /** 채우려는 필요 정보 항목의 key */
  fillsKey: string;
  type: QuestionType;
  prompt: string;
  options?: string[];
  /** 한 줄 이유 */
  why: string;
  /** text/attachment일 때 왜 선택지로 못 묻는지. 없으면 버린다. */
  justification?: string;
};

const questionSchema = z.object({
  id: z.string().describe("질문 id. 서버가 다시 붙이므로 아무 문자열이나 괜찮다"),
  fillsKey: z.string().describe("채우려는 필요 정보 항목의 key"),
  type: z.enum(QUESTION_TYPES),
  prompt: z.string().describe("요청자에게 보여 줄 질문"),
  options: z.array(z.string()).optional().describe("single/multi/scale의 선택지. '직접 입력'과 '모르겠어요'는 넣지 않는다"),
  why: z.string().describe("왜 필요한지 한 줄"),
  justification: z.string().optional().describe("text/attachment일 때 왜 선택지로 물을 수 없는지"),
});

export const InterviewResult = z.object({
  done: z.boolean().describe("더 물을 것이 없으면 true"),
  questions: z.array(questionSchema),
});
export type InterviewResult = z.infer<typeof InterviewResult>;

export type AnsweredQuestion = {
  fillsKey: string;
  value: string | string[] | typeof UNKNOWN_VALUE;
  attachmentUrls?: string[];
};

const isBlankValue = (v: AnsweredQuestion["value"]) =>
  Array.isArray(v) ? v.every((x) => x.trim() === "") : v.trim() === "";

/** 이 답변이 해당 항목을 채웠는가: "모르겠어요", 비어 있지 않은 답, 첨부. */
const answered = (a: AnsweredQuestion) => !isBlankValue(a.value) || (a.attachmentUrls?.length ?? 0) > 0;

/** 이미 채운 필요 정보 키: 답변으로 채운 것 + "모르겠어요"로 답한 것 + 티켓에 이미 첨부가 있으면 screenshot. */
export function filledKeys(ticket: { hasAttachments?: boolean }, answers: AnsweredQuestion[]): Set<string> {
  const keys = new Set<string>();
  for (const a of answers) if (answered(a)) keys.add(a.fillsKey);
  if (ticket.hasAttachments) keys.add("screenshot");
  return keys;
}

/**
 * 모델이 만든 질문을 규칙에 맞게 걸러낸다(인터뷰 설계 4.2, 5.3).
 * - text/attachment는 justification이 없으면 버린다(선택지 우선).
 * - 이미 채운 fillsKey, 같은 fillsKey의 두 번째 이후, (있으면) 목록에 없는 fillsKey는 버린다.
 * - 최대 3개.
 */
export function normalizeQuestions(
  qs: Question[],
  opts: { filledKeys: Set<string>; knownKeys?: Set<string> },
): Question[] {
  const seen = new Set<string>();
  const out: Question[] = [];
  for (const q of qs) {
    if ((q.type === "text" || q.type === "attachment") && !q.justification?.trim()) continue;
    if (opts.filledKeys.has(q.fillsKey) || seen.has(q.fillsKey)) continue;
    if (opts.knownKeys && !opts.knownKeys.has(q.fillsKey)) continue;
    if (!q.prompt.trim()) continue;
    seen.add(q.fillsKey);
    const { options, ...rest } = q;
    out.push(q.type === "text" || q.type === "attachment" ? rest : { ...rest, options: options ?? [] });
    if (out.length === MAX_QUESTIONS_PER_ROUND) break;
  }
  return out;
}

/** 질문 id는 서버가 라운드와 순서로 붙인다(모델이 준 id는 겹치거나 비어 있을 수 있다). */
export const assignQuestionIds = (qs: Question[], round: number): Question[] =>
  qs.map((q, i) => ({ ...q, id: `r${round}-q${i + 1}` }));

/**
 * 화면에 보일 선택지: single/multi/scale에는 "직접 입력"과 "모르겠어요"를 항상 덧붙인다(이미 있으면 중복하지 않는다).
 * 저장된 질문은 건드리지 않고 새 객체를 돌려준다. UI가 호출한다.
 */
export function withDisplayOptions(q: Question): Question {
  if (q.type !== "single" && q.type !== "multi" && q.type !== "scale") return q;
  const options = [...(q.options ?? [])];
  for (const extra of [OTHER_OPTION, UNKNOWN_OPTION]) if (!options.includes(extra)) options.push(extra);
  return { ...q, options };
}

export const interviewSystem = (
  instructions: string,
  ctx: { round: number; fields: RequiredField[]; filled: Set<string> },
) => {
  const list = ctx.fields
    .map(
      (x) =>
        `- ${x.key}: ${x.label} (${x.required ? "필수" : "선택"}, 선호 유형 ${x.preferredType})${ctx.filled.has(x.key) ? " — 이미 채워짐" : ""}`,
    )
    .join("\n");
  return `${instructions}

# 이번 작업: 인터뷰 질문 만들기 (라운드 ${ctx.round}/${MAX_ROUNDS})
개발자가 되묻지 않고 바로 일하려면 필요한 정보 중 아직 비어 있는 것을 요청자에게 묻습니다. 티켓 본문과 지금까지의 답변을 먼저 읽고, 이미 알 수 있는 것은 묻지 않습니다.

## 필요 정보 목록
${list}

## 규칙
- 질문은 최대 ${MAX_QUESTIONS_PER_ROUND}개이고, 필수 항목부터 묻습니다. fillsKey는 위 목록의 key만 씁니다.
- "이미 채워짐"인 항목, 본문에 이미 답이 있는 항목, 앞 라운드에서 물은 항목은 묻지 않습니다.
- single/multi/scale의 options에는 추측한 답을 앞에 두고, "${OTHER_OPTION}"과 "${UNKNOWN_OPTION}"은 넣지 않습니다(화면이 붙입니다).
- text/attachment는 선택지로 물을 수 없을 때만 쓰고 justification을 적습니다. 없으면 버려집니다.
- 물을 것이 없으면 done을 true로, questions는 빈 배열로 답합니다.`;
};
