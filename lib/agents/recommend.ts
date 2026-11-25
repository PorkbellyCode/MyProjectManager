import { z } from "zod";
import type { Db } from "@/lib/db";
import { validEvidence, type Evidence, type EvidenceCtx } from "@/lib/review/normalize";
import { InvalidTargetError, validateTarget, type Target } from "@/lib/tickets/targets";

export const RecommendResult = z.object({
  target: z
    .union([
      z.object({ kind: z.literal("user"), userId: z.string() }),
      z.object({ kind: z.literal("group"), groupId: z.string() }),
    ])
    .nullable()
    .describe("추천 대상 하나. 맞는 곳이 분명하지 않으면 null"),
  reason: z.string().describe("추천 이유 한두 문장. 추천이 없으면 빈 문자열"),
  evidence: z.array(z.object({ ref: z.string(), note: z.string() })),
});
export type RecommendResult = z.infer<typeof RecommendResult>;

/** `ready` 턴과 비고에 저장하는 추천. target이 null이면 추천이 없다. */
export type Recommendation = { target: Target; reason: string; evidence: Evidence[] };

export const NO_RECOMMENDATION: Recommendation = { target: null, reason: "", evidence: [] };

export const recommendSystem = (instructions: string) =>
  `${instructions}

# 이번 작업: 대상 추천
이 티켓을 처리할 그룹 또는 사람을 하나 추천합니다. getGroups로 그룹의 담당 범위와 레포 태그를 확인하고, searchTickets로 비슷했던 과거 티켓을 확인하세요.
- 추천은 미리 채워지는 값일 뿐이고, 결정은 요청자와 리드가 합니다. 부하나 점수로 자동 배정하지 않습니다.
- target은 도구로 확인한 그룹 id 또는 프로젝트 멤버 id만 씁니다. reason에는 무엇을 근거로 골랐는지 적습니다.
- 근거 ref 형식: ticket:<id>, commit:<sha>, pr:<번호>, doc:<id>. 도구로 확인한 것만 씁니다.
- 맞는 곳이 분명하지 않으면 target을 null로 답합니다.`;

/**
 * 추천을 정규화한다(Review Focus 5). 프로젝트에 없는 사람·그룹이거나 이유가 없으면 추천하지 않는다(null).
 * 근거 ref 중 존재하지 않는 것은 제거한다.
 */
export async function normalizeRecommendation(
  db: Db,
  projectId: string,
  r: RecommendResult,
  ctx: EvidenceCtx,
  selfId: string,
): Promise<Recommendation> {
  const reason = r.reason.trim();
  if (!r.target || !reason) return NO_RECOMMENDATION;
  let target: Target;
  try {
    target = await validateTarget(db, projectId, r.target);
  } catch (e) {
    if (e instanceof InvalidTargetError) return NO_RECOMMENDATION;
    throw e;
  }
  return { target, reason, evidence: validEvidence(r.evidence, ctx, selfId) };
}
