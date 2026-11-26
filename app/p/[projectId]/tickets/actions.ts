"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { tickets } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ForbiddenError } from "@/lib/access";
import { EmptyCommentError, addComment } from "@/lib/comments/service";
import {
  AiUnavailableError,
  answerDuplicate,
  answerQuestions,
  answerResolution,
  InvalidAnswerError,
  NoOpenCardError,
  requestReview,
  submitTicket,
} from "@/lib/review/pipeline";
import { editSummary, SummaryNotEditableError } from "@/lib/review/summary";
import { isUuid } from "@/lib/tickets/detail";
import {
  ConflictError,
  createDraft,
  getActorCtx,
  InvalidDuplicateError,
  performAction,
  TicketNotFoundError,
} from "@/lib/tickets/service";
import { TransitionError, type ActorCtx } from "@/lib/tickets/state-machine";
import { InvalidTargetError } from "@/lib/tickets/targets";
import {
  addCommentSchema,
  answerDuplicateSchema,
  answerQuestionsSchema,
  answerResolutionSchema,
  closeSchema,
  CONFLICT_MESSAGE,
  createTicketSchema,
  editSummarySchema,
  reopenSchema,
  submitSchema,
  versionOnlySchema,
  type ActionResult,
  type CreateTicketResult,
} from "./schemas";

/**
 * 요청자 화면의 서버 액션. 모두 세션으로 사용자를 정하고, 입력을 zod로 검사하고, 티켓이 이 프로젝트의 것인지 확인한다.
 * 티켓을 바꾸는 액션은 화면이 본 `expectedVersion`을 받는다. 그 사이 바뀌었으면 code "conflict"(화면은 안내 후 새로 고침).
 * 성공하면 refresh()로 현재 화면을 같은 응답에서 다시 그린다.
 */

const NOT_FOUND = "티켓을 찾을 수 없어요.";

class ActionInputError extends Error {}

function fail(err: unknown): ActionResult & { ok: false } {
  if (err instanceof ConflictError || err instanceof NoOpenCardError) return { ok: false, code: "conflict", error: CONFLICT_MESSAGE };
  if (err instanceof TransitionError) {
    // 상태가 이미 바뀌어 할 수 없는 동작은 충돌과 같게 다룬다(화면이 낡았다).
    if (err.code === "invalid_transition") return { ok: false, code: "conflict", error: CONFLICT_MESSAGE };
    const message = err.message.replace(/^\w+: /, "");
    return { ok: false, code: err.code === "forbidden" ? "forbidden" : "invalid", error: message };
  }
  if (err instanceof TicketNotFoundError) return { ok: false, code: "not_found", error: NOT_FOUND };
  if (err instanceof ForbiddenError) return { ok: false, code: "forbidden", error: err.message };
  if (
    err instanceof InvalidTargetError ||
    err instanceof InvalidDuplicateError ||
    err instanceof InvalidAnswerError ||
    err instanceof SummaryNotEditableError ||
    err instanceof EmptyCommentError ||
    err instanceof AiUnavailableError ||
    err instanceof ActionInputError
  ) {
    return { ok: false, code: "invalid", error: err.message };
  }
  console.error("[tickets/actions]", err);
  return { ok: false, code: "error", error: "처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요." };
}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new ActionInputError(r.error.issues[0]?.message ?? "입력 값이 올바르지 않아요.");
  return r.data;
}

/** 로그인 사용자 + 프로젝트 멤버 문맥. 멤버가 아니면 없는 티켓과 같게(404) 다룬다. */
async function actorFor(projectId: string): Promise<ActorCtx> {
  const u = await getSessionUser();
  if (!u) throw new ForbiddenError("로그인이 필요해요.");
  if (!isUuid(projectId)) throw new TicketNotFoundError();
  try {
    return await getActorCtx(db, projectId, u.id);
  } catch (e) {
    if (e instanceof ForbiddenError) throw new TicketNotFoundError();
    throw e;
  }
}

/** 티켓이 이 프로젝트의 것인지 확인한다(다른 프로젝트의 id로 부르는 것을 막는다). */
async function ticketIn(projectId: string, ticketId: string) {
  if (!isUuid(ticketId)) throw new TicketNotFoundError();
  const [t] = await db.select({ id: tickets.id, projectId: tickets.projectId }).from(tickets).where(eq(tickets.id, ticketId));
  if (!t || t.projectId !== projectId) throw new TicketNotFoundError();
  return t;
}

async function run(projectId: string, ticketId: string, fn: (actor: ActorCtx) => Promise<unknown>): Promise<ActionResult> {
  try {
    const actor = await actorFor(projectId);
    await ticketIn(projectId, ticketId);
    await fn(actor);
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

/**
 * 새 티켓. intent: "review"면 초안을 만들고 바로 AI 검토를 요청하고, "submit"이면 바로 제출한다.
 * 검토 요청이 실패해도(예: 그 사이 프로젝트가 AI를 못 쓰게 됨) 초안은 남고 상세 화면으로 간다.
 */
export async function createDraftAction(projectId: string, input: unknown): Promise<CreateTicketResult> {
  let ticketId: string;
  try {
    const actor = await actorFor(projectId);
    const data = parse(createTicketSchema, input);
    const t = await createDraft(db, {
      projectId,
      authorId: actor.userId!,
      title: data.title,
      body: data.body,
      category: data.category,
      urgency: data.urgency,
      target: data.target,
    });
    ticketId = t.id;
    if (data.intent === "review") {
      await requestReview(db, { ticketId: t.id, expectedVersion: t.version, actor }).catch((e) => {
        if (!(e instanceof AiUnavailableError)) throw e;
      });
    } else if (data.intent === "submit") {
      await submitTicket(db, { ticketId: t.id, expectedVersion: t.version, actor, target: data.target });
    }
  } catch (e) {
    return fail(e);
  }
  return { ok: true, ticketId };
}

export async function requestReviewAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const { expectedVersion } = parse(versionOnlySchema, input);
    await requestReview(db, { ticketId, expectedVersion, actor });
  });
}

export async function answerDuplicateAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(answerDuplicateSchema, input);
    if (data.choice === "same") {
      await answerDuplicate(db, { ticketId, expectedVersion: data.expectedVersion, actor, choice: "same", ticketIdToJoin: data.ticketIdToJoin });
    } else {
      await answerDuplicate(db, { ticketId, expectedVersion: data.expectedVersion, actor, choice: "different" });
    }
  });
}

export async function answerResolutionAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(answerResolutionSchema, input);
    await answerResolution(db, { ticketId, expectedVersion: data.expectedVersion, actor, choice: data.choice });
  });
}

export async function answerQuestionsAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(answerQuestionsSchema, input);
    await answerQuestions(db, { ticketId, expectedVersion: data.expectedVersion, actor, answers: data.answers });
  });
}

export async function submitAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(submitSchema, input);
    await submitTicket(db, { ticketId, expectedVersion: data.expectedVersion, actor, target: data.target });
  });
}

export async function editSummaryAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(editSummarySchema, input);
    // 정리본 수정은 티켓 version을 올리지 않는다. 화면이 본 뒤 상태가 바뀌었으면 낡은 화면으로 본다.
    const [cur] = await db.select({ version: tickets.version }).from(tickets).where(eq(tickets.id, ticketId));
    if (!cur || cur.version !== data.expectedVersion) throw new ConflictError();
    await editSummary(db, { ticketId, actor, markdown: data.markdown });
  });
}

export async function confirmFixedAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const { expectedVersion } = parse(versionOnlySchema, input);
    await performAction(db, { ticketId, expectedVersion, actor, action: { type: "confirmFixed" } });
  });
}

export async function reopenAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(reopenSchema, input);
    await performAction(db, { ticketId, expectedVersion: data.expectedVersion, actor, action: { type: "reopen", reason: data.reason } });
  });
}

export async function closeAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(closeSchema, input);
    await performAction(db, {
      ticketId,
      expectedVersion: data.expectedVersion,
      actor,
      action: { type: "close", reason: data.reason, note: data.note, duplicateOfId: data.duplicateOfId },
    });
  });
}

export async function addCommentAction(projectId: string, ticketId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, ticketId, async (actor) => {
    const data = parse(addCommentSchema, input);
    await addComment(db, { ticketId, authorId: actor.userId!, body: data.body });
  });
}
