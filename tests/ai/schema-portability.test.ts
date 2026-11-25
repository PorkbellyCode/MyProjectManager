import { describe, expect, test } from "vitest";
import { z } from "zod";
import { dedupSchema } from "@/lib/agents/dedup";
import { InterviewResult } from "@/lib/agents/interview";
import { RecommendResult } from "@/lib/agents/recommend";
import { repoOverviewSchema } from "@/lib/agents/repo-analyst";
import { resolveSchema } from "@/lib/agents/resolve";
import { SummaryResult } from "@/lib/agents/summarize";

/** 모든 에이전트 출력 스키마. 새 스키마를 만들면 여기에 넣는다(R21). */
const SCHEMAS: Record<string, z.ZodType> = {
  dedup: dedupSchema,
  resolve: resolveSchema,
  repoOverview: repoOverviewSchema,
  interview: InterviewResult,
  recommend: RecommendResult,
  summary: SummaryResult,
};

/** OpenAI strict 모드가 받는 모양인지 훑는다. 어긋난 곳의 경로를 모아 돌려준다. */
function violations(node: unknown, path = "#"): string[] {
  if (!node || typeof node !== "object") return [];
  const n = node as Record<string, unknown>;
  const out: string[] = [];
  if ("propertyNames" in n) out.push(`${path}: propertyNames`);
  if ("patternProperties" in n) out.push(`${path}: patternProperties`);
  const props = n.properties as Record<string, unknown> | undefined;
  if (n.type === "object" || props) {
    if (n.additionalProperties !== false) out.push(`${path}: additionalProperties !== false`);
    const required = new Set((n.required as string[] | undefined) ?? []);
    for (const k of Object.keys(props ?? {})) if (!required.has(k)) out.push(`${path}.${k}: not in required`);
  }
  for (const [k, v] of Object.entries(n)) {
    if (Array.isArray(v)) v.forEach((x, i) => out.push(...violations(x, `${path}/${k}[${i}]`)));
    else if (v && typeof v === "object") {
      if (k === "properties") for (const [pk, pv] of Object.entries(v)) out.push(...violations(pv, `${path}.${pk}`));
      else out.push(...violations(v, `${path}/${k}`));
    }
  }
  return out;
}

describe("에이전트 출력 스키마는 strict 모드에서도 쓸 수 있다(R21)", () => {
  test.each(Object.entries(SCHEMAS))("%s", (_name, schema) => {
    const json = z.toJSONSchema(schema);
    expect(violations(json)).toEqual([]);
  });

  test("검사기 자체: 열린 객체와 선택 속성은 잡아낸다", () => {
    expect(violations(z.toJSONSchema(z.object({ a: z.string().optional() })))).not.toEqual([]);
    expect(violations(z.toJSONSchema(z.object({ m: z.record(z.string(), z.string()) })))).not.toEqual([]);
  });
});
