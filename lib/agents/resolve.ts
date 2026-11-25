import { z } from "zod";

export const resolveSchema = z.object({
  kind: z.enum(["already_resolved", "expected_behavior", "none"]),
  message: z.string().describe("요청자에게 보여 줄 한두 문장. none이면 빈 문자열"),
  evidence: z.array(z.object({ ref: z.string(), note: z.string() })),
});
export type ResolveOutput = z.infer<typeof resolveSchema>;

export const resolveSystem = (instructions: string) =>
  `${instructions}\n\n# 이번 작업: 해소 확인\n검토 중인 티켓이 이미 해결되었거나(already_resolved) 정상 동작(expected_behavior)인지 확인합니다.\n- 근거 ref 형식: ticket:<id>, commit:<sha>, pr:<번호>, doc:<id>. 도구로 확인한 것만 씁니다.\n- 근거가 없거나 모르면 kind를 none으로 답합니다.`;
