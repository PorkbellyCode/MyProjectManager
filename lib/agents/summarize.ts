import { z } from "zod";
import type { RequiredField } from "@/lib/agents/interview";
import type { SummaryOrigin } from "@/lib/db/schema/review";
import type { Urgency } from "@/lib/db/schema/tickets";

export const UNKNOWN_TEXT = "알 수 없음";

export const SummaryResult = z.object({
  summary: z.string().describe("무엇이 문제이고 무엇이 필요한지 짧은 마크다운"),
  fields: z.record(z.string(), z.string().nullable()).describe("필요 정보 key별 값. 답을 못 받았으면 '알 수 없음', 해당 없으면 null"),
  fillRate: z.number().describe("채운 필수 항목 수 / 전체 필수 항목 수"),
  urgencyNote: z.string().nullable().describe("긴급도 참고 문구. 요청자가 정한 값을 적기만 한다. 없으면 null"),
});
export type SummaryResult = z.infer<typeof SummaryResult>;

export const summarizeSystem = (instructions: string, fields: RequiredField[]) =>
  `${instructions}

# 이번 작업: 정리본 만들기
요청자의 원문과 인터뷰 답변을 개발자가 읽기 좋게 정리합니다. 마크다운 전체가 아니라 아래 구조의 값만 답합니다(문서는 코드가 만듭니다).
- summary: 두세 문장 요약.
- fields: 아래 key마다 값 하나. 원문이나 답변에 없으면 null, 요청자가 "모르겠어요"로 답했으면 "${UNKNOWN_TEXT}". 없는 내용을 지어내지 않습니다.
- fillRate: 채운 필수 항목 수 / 전체 필수 항목 수 (참고용, 코드가 다시 계산합니다).
- urgencyNote: 요청자가 정한 긴급도를 참고 문구로만 적습니다. 긴급도를 판단하거나 바꾸라고 하지 않습니다.

## 필요 정보 key
${fields.map((x) => `- ${x.key}: ${x.label}${x.required ? " (필수)" : ""}`).join("\n")}`;

/** 필수 항목 중 실제 값이 있는 비율(알 수 없음·비어 있음 제외). 필수 항목이 없으면 1. */
export function computeFillRate(fields: RequiredField[], values: Record<string, string | null>): number {
  const required = fields.filter((x) => x.required);
  if (required.length === 0) return 1;
  const filled = required.filter((x) => {
    const v = values[x.key];
    return typeof v === "string" && v.trim() !== "" && v !== UNKNOWN_TEXT;
  }).length;
  return Math.round((filled / required.length) * 100) / 100;
}

export const URGENCY_LABEL: Record<Urgency, string> = { low: "낮음", normal: "보통", high: "높음", urgent: "긴급" };

/** 정리본 마크다운. 모델이 아니라 코드가 같은 입력에 같은 결과를 만든다. */
export function renderSummaryMarkdown(input: {
  result: SummaryResult;
  fields: RequiredField[];
  generatedFrom: SummaryOrigin;
  urgency: Urgency;
}): string {
  const { result, fields, generatedFrom, urgency } = input;
  const lines: string[] = ["## 요약", "", result.summary.trim(), "", "## 필요 정보", ""];
  for (const x of fields) {
    const v = result.fields[x.key];
    if (v === null || v === undefined) continue;
    lines.push(`- **${x.label}**: ${v}`);
  }
  const required = fields.filter((x) => x.required);
  const filled = required.filter((x) => {
    const v = result.fields[x.key];
    return typeof v === "string" && v.trim() !== "" && v !== UNKNOWN_TEXT;
  }).length;
  lines.push("", `채움률: ${Math.round(result.fillRate * 100)}% (필수 ${filled}/${required.length})`);
  if (generatedFrom === "original_only") lines.push("", "> 인터뷰 없이 제출됨");
  if (result.urgencyNote?.trim()) {
    lines.push("", `> 긴급도 참고: ${result.urgencyNote.trim()} (요청자가 정한 긴급도: ${URGENCY_LABEL[urgency]})`);
  }
  return lines.join("\n");
}
