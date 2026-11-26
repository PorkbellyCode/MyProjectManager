import { z } from "zod";

/** 요청자 화면 액션의 입력 스키마. 서버 액션(검증)과 클라이언트 폼(react-hook-form)이 같이 쓴다. */

export const CONFLICT_MESSAGE = "다른 곳에서 바뀌었어요. 새로 고칠게요.";

export type ActionResult =
  | { ok: true }
  | { ok: false; code: "conflict" | "not_found" | "forbidden" | "invalid" | "error"; error: string };
export type CreateTicketResult = { ok: true; ticketId: string } | Extract<ActionResult, { ok: false }>;

const version = z.number().int().min(0);

export const targetSchema = z
  .union([
    z.object({ kind: z.literal("user"), userId: z.string().min(1) }),
    z.object({ kind: z.literal("group"), groupId: z.string().uuid() }),
  ])
  .nullable();

export const TITLE_MAX = 120;

export const ticketFormSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, "제목을 적어 주세요.")
    .max(TITLE_MAX, `제목은 ${TITLE_MAX}자 이하로 적어 주세요.`),
  body: z.string().max(50_000, "본문이 너무 길어요."),
  category: z.enum(["defect", "improvement", "feature", "inquiry"], { error: "카테고리를 골라 주세요." }),
  urgency: z.enum(["low", "normal", "high", "urgent"]),
  target: targetSchema,
});
export type TicketFormValues = z.infer<typeof ticketFormSchema>;

export const createTicketSchema = ticketFormSchema.extend({ intent: z.enum(["draft", "review", "submit"]) });

export const versionOnlySchema = z.object({ expectedVersion: version });

export const answerDuplicateSchema = z.discriminatedUnion("choice", [
  z.object({ expectedVersion: version, choice: z.literal("same"), ticketIdToJoin: z.string().uuid() }),
  z.object({ expectedVersion: version, choice: z.literal("different") }),
]);

export const answerResolutionSchema = z.object({
  expectedVersion: version,
  choice: z.enum(["resolved", "continue", "submit"]),
});

export const answerSchema = z.object({
  questionId: z.string().min(1),
  value: z.union([z.string(), z.array(z.string()).min(1)]),
  attachmentUrls: z.array(z.string().min(1)).max(10).optional(),
});

export const answerQuestionsSchema = z.object({
  expectedVersion: version,
  answers: z.array(answerSchema).min(1, "답변을 하나 이상 입력해 주세요.").max(3),
});

export const submitSchema = z.object({ expectedVersion: version, target: targetSchema });

export const editSummarySchema = z.object({
  expectedVersion: version,
  markdown: z.string().trim().min(1, "정리본 내용을 입력해 주세요.").max(50_000),
});

export const reopenSchema = z.object({
  expectedVersion: version,
  reason: z.string().trim().min(1, "아직인 이유를 적어 주세요.").max(2000),
});

export const closeSchema = z.object({
  expectedVersion: version,
  reason: z.enum(["resolved_confirmed", "wont_do", "duplicate", "requester_withdrawn", "other"]),
  note: z.string().trim().max(2000).optional(),
  duplicateOfId: z.string().uuid().optional(),
});

export const addCommentSchema = z.object({
  body: z.string().trim().min(1, "댓글 내용을 적어 주세요.").max(50_000),
});

/** 회수 사유 선택지(요청자). "직접 입력"이면 note에 적는다. */
export const WITHDRAW_REASONS = ["내 실수였어요", "더 이상 필요 없어요"] as const;
