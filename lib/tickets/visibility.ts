import { eq, notInArray, or, type SQL } from "drizzle-orm";
import { tickets } from "@/lib/db/schema/tickets";
import type { TicketStatus } from "@/lib/db/schema/tickets";

/**
 * R24: 한 번도 제출되지 않은 티켓(작성 중, AI 검토 중, 요청자 확인 대기, 제출 없이 철회)의 공통 규칙.
 * - 작성자에게만 보인다: 다른 사람의 목록 뷰·개수·검색·상세(404)에서 빠진다(리드 포함).
 * - 중복 원본이 될 수 없다.
 * 이 모듈은 상태 목록과 술어만 둔다(DB 호출 없음).
 */
export const NOT_SUBMITTED_STATUSES = ["draft", "ai_reviewing", "awaiting_requester", "withdrawn_ai_resolved"] as const satisfies readonly TicketStatus[];

const NOT_SUBMITTED = new Set<string>(NOT_SUBMITTED_STATUSES);

/** 제출된 적이 있는 상태인가(큐 대기 이후). */
export const isSubmittedStatus = (status: TicketStatus | string): boolean => !NOT_SUBMITTED.has(status);

/** 이 사용자가 볼 수 있는 티켓인가: 제출됐거나 본인이 작성자. */
export const canSeeTicket = (t: { status: TicketStatus | string; authorId: string }, userId: string): boolean =>
  isSubmittedStatus(t.status) || t.authorId === userId;

/** SQL: 제출된 티켓만. */
export const submittedOnly = (): SQL => notInArray(tickets.status, [...NOT_SUBMITTED_STATUSES]);

/** SQL: 이 사용자에게 보이는 티켓(제출됐거나 본인 작성). */
export const visibleTo = (userId: string): SQL => or(submittedOnly(), eq(tickets.authorId, userId))!;
