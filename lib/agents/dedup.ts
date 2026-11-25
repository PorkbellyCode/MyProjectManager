import { z } from "zod";

/**
 * 중복 판단 기준(제품 책임자 결정). 프로필 지시사항 뒤에 코드에서 덧붙인다.
 * 저장된 기본 프로필 문구와 별개로 항상 적용된다.
 */
export const DEDUP_CRITERIA = `## 중복 판단 기준 (반드시 지킬 것)
- 후보를 "같은 건"이라고 하려면 세 가지가 모두 같아야 합니다: (1) 증상, (2) 위치(화면·모듈·API), (3) 발생 조건.
- 오류 메시지가 비슷해도 다른 화면, 다른 모듈, 다른 API에서 난 것이면 중복이 아닙니다. 후보에 넣지 않습니다.
- 세 가지 중 하나라도 확인하지 못했거나 다르면 후보에 넣지 않습니다. 애매하면 넣지 않습니다.
- 후보마다 reason(왜 같은 건으로 보는지)과 differences(남아 있는 차이점, 없으면 빈 문자열)를 적습니다.
- 후보는 도구로 실제로 확인한 티켓만, 최대 3개입니다. 같은 건이 없으면 candidates를 빈 배열로 답합니다.`;

export const dedupSchema = z.object({
  candidates: z.array(
    z.object({
      ticketId: z.string().describe("후보 티켓의 id"),
      reason: z.string().describe("같은 건으로 보는 이유"),
      differences: z.string().describe("남아 있는 차이점. 없으면 빈 문자열"),
    }),
  ),
});
export type DedupOutput = z.infer<typeof dedupSchema>;

export const dedupSystem = (instructions: string) =>
  `${instructions}\n\n# 이번 작업: 중복 확인\n검토 중인 티켓과 같은 건인 이미 제출된 티켓이 있는지 찾습니다. searchTickets로 검색하세요.\n\n${DEDUP_CRITERIA}`;
