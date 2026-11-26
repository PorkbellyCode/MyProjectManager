import { z } from "zod";
import { MAX_LINKED_REFS, normalizeLinkedRef } from "@/lib/tickets/linked-refs";

/** 요청자 화면 액션의 입력 스키마. 서버 액션(검증)과 클라이언트 폼(react-hook-form)이 같이 쓴다. */

/** 다른 사람이 먼저 처리했거나 화면이 낡았을 때(ConflictError 등). 화면은 이 안내 후 새로 고친다. */
export const CONFLICT_MESSAGE = "이미 다른 사람이 처리했어요. 새로고침해 주세요.";

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
  /** 중복 원본을 번호로 고를 때(처리 담당 종결 다이얼로그). 서버가 같은 프로젝트의 티켓 id로 바꾼다. */
  duplicateOfNumber: z.number().int().positive().optional(),
});

// ---------- 처리 담당(개발자·리드) 화면 ----------

const reasonText = (message: string) => z.string().trim().min(1, message).max(2000, "사유는 2000자 이하로 적어 주세요.");

export const assignSchema = z.object({ expectedVersion: version, target: targetSchema });

export const transferSchema = z.object({
  expectedVersion: version,
  target: targetSchema,
  reason: reasonText("이관 사유를 적어 주세요."),
});

export const holdSchema = z.object({ expectedVersion: version, reason: reasonText("보류 사유를 적어 주세요.") });

export const reopenClosedSchema = z.object({ expectedVersion: version, reason: reasonText("다시 여는 사유를 적어 주세요.") });

export const proposeWontDoSchema = z.object({ expectedVersion: version, reason: reasonText("제안 사유를 적어 주세요.") });

/** 처리 완료에 링크하는 참조(`pr:12`, `commit:abc1234`, `ticket:<uuid>`). 형식이 틀리면 거부한다. */
export const linkedRefsSchema = z
  .array(z.string().max(80))
  .max(MAX_LINKED_REFS, `관련 변경은 ${MAX_LINKED_REFS}개까지 링크할 수 있어요.`)
  .refine((refs) => refs.every((r) => !r.trim() || normalizeLinkedRef(r) !== null), "PR 번호나 커밋 SHA 형식이 올바르지 않아요.");

export const resolveSchema = z.object({ expectedVersion: version, linkedRefs: linkedRefsSchema.optional() });

/** 처리 완료 다이얼로그의 입력. PR 번호(숫자, 선택)와 커밋 SHA(공백·쉼표로 여러 개, 선택). */
export const resolveFormSchema = z.object({
  pr: z
    .string()
    .trim()
    .regex(/^(#?\d{1,7})?$/, "PR 번호는 숫자 7자리 이하로 적어 주세요."),
  commits: z
    .string()
    .trim()
    .refine((v) => v.split(/[\s,]+/).filter(Boolean).every((c) => /^[0-9a-fA-F]{7,40}$/.test(c)), "커밋 SHA는 7~40자리 16진수로 적어 주세요."),
});

export const setUrgencySchema = z.object({ expectedVersion: version, to: z.enum(["low", "normal", "high", "urgent"]) });

export const markReadSchema = z.object({ ids: z.array(z.string().uuid()).max(100).optional() });

export const addCommentSchema = z.object({
  body: z.string().trim().min(1, "댓글 내용을 적어 주세요.").max(50_000),
});

/** 회수 사유 선택지(요청자). "직접 입력"이면 note에 적는다. */
export const WITHDRAW_REASONS = ["내 실수였어요", "더 이상 필요 없어요"] as const;
