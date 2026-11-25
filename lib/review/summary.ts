import { eq, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { ticketEvents, ticketSummaries, tickets } from "@/lib/db/schema";
import { ForbiddenError } from "@/lib/access";
import { getActiveProfile } from "@/lib/agents/profiles";
import { UNKNOWN_VALUE } from "@/lib/agents/interview";
import {
  computeFillRate,
  renderSummaryMarkdown,
  SummaryResult,
  summarizeSystem,
  UNKNOWN_TEXT,
} from "@/lib/agents/summarize";
import { emitNotifications } from "@/lib/notifications/emit";
import { insertJudgment, invoke, ticketPrompt, type JudgmentBase, type ReviewDeps } from "@/lib/review/pipeline";
import { getRequiredFields, loadAnswered, renderAnswered } from "@/lib/review/records";
import { TicketNotFoundError } from "@/lib/tickets/service";
import type { ActorCtx } from "@/lib/tickets/state-machine";

export class SummaryNotEditableError extends Error {
  constructor(message = "지금은 정리본을 고칠 수 없어요. 보충할 내용은 댓글로 남겨 주세요.") {
    super(message);
    this.name = "SummaryNotEditableError";
  }
}

/** 제출 전 상태나 철회된 티켓은 정리하지 않는다. */
const NOT_SUBMITTED = new Set(["draft", "ai_reviewing", "awaiting_requester", "withdrawn_ai_resolved"]);

/**
 * 제출된 티켓의 정리본을 만든다(요청자 원문 + 인터뷰 답변). 인터뷰 기록이 있으면 `interview`, 없으면 `original_only`.
 * - 마크다운은 코드가 만든다. 모델은 요약과 항목 값만 답한다.
 * - 채움률은 코드가 계산하고, "모르겠어요"로 답한 항목은 "알 수 없음", 목록에 없는 항목은 버린다.
 * - 긴급도는 `urgencyNote` 참고 문구로만 남고 티켓의 긴급도는 건드리지 않는다.
 * - 요청자가 이미 고친 정리본은 다시 쓰지 않는다. 실패하면 판단 `failed`를 남기고 던진다(작업 재시도).
 */
export async function summarizeTicket(db: Db, ticketId: string, deps: ReviewDeps = {}): Promise<void> {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t || NOT_SUBMITTED.has(t.status)) return;
  const [existing] = await db.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, ticketId));
  if (existing?.editedAt) return;

  const answered = await loadAnswered(db, ticketId);
  const generatedFrom = answered.length > 0 ? ("interview" as const) : ("original_only" as const);
  const fields = await getRequiredFields(db, t.projectId, t.category);
  const profile = await getActiveProfile(db, t.projectId, "summarizer");
  const base: JudgmentBase = {
    projectId: t.projectId,
    ticketId: t.id,
    stage: null,
    role: "summarizer",
    profile,
    input: { title: t.title, body: t.body, category: t.category, urgency: t.urgency, generatedFrom },
  };
  const prompt = [ticketPrompt(t), "", "## 인터뷰 기록", renderAnswered(answered)].join("\n");

  let res;
  try {
    res = await invoke(db, t, profile, summarizeSystem(profile.instructions, fields), SummaryResult, deps, prompt);
  } catch (err) {
    await insertJudgment(db, base, { status: "failed", error: err instanceof Error ? err.message : String(err) });
    throw err;
  }

  const keys = new Set(fields.map((f) => f.key));
  const values: Record<string, string | null> = {};
  for (const f of fields) values[f.key] = res.parsed.fields[f.key] ?? null;
  for (const a of answered) if (a.value === UNKNOWN_VALUE && keys.has(a.fillsKey)) values[a.fillsKey] = UNKNOWN_TEXT;
  const result: SummaryResult = {
    summary: res.parsed.summary,
    fields: values,
    fillRate: computeFillRate(fields, values),
    urgencyNote: res.parsed.urgencyNote?.trim() || null,
  };
  const markdown = renderSummaryMarkdown({ result, fields, generatedFrom, urgency: t.urgency });
  const data = { ...result, fieldDefs: fields };

  await db.transaction(async (tx) => {
    await insertJudgment(tx, base, { status: "ok", output: res.output, normalized: result, run: res });
    await tx
      .insert(ticketSummaries)
      .values({ ticketId, markdown, data, generatedFrom })
      .onConflictDoUpdate({
        target: ticketSummaries.ticketId,
        set: { markdown, data, generatedFrom },
        // 그 사이 요청자가 고쳤다면 덮어쓰지 않는다.
        setWhere: sql`${ticketSummaries.editedAt} is null`,
      });
  });
}

/**
 * 요청자가 정리본을 고친다. 작성자만, 담당자가 수락하거나 가져가기 전(대기열 `queued` 또는 지정됨 `assigned`)에만 된다.
 * 수락·가져가기는 상태를 `in_progress`로 옮기므로 상태만 보면 된다. 이후 보충은 댓글로 한다.
 * 이벤트 `summary_edited`가 남고 담당자에게 알림이 간다.
 */
export async function editSummary(db: Db, input: { ticketId: string; actor: ActorCtx; markdown: string }): Promise<void> {
  const markdown = input.markdown.trim();
  await db.transaction(async (tx) => {
    // 수락·가져가기와 겹치지 않도록 티켓 행을 잠근다.
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId)).for("update");
    if (!t) throw new TicketNotFoundError();
    if (input.actor.userId === null || input.actor.userId !== t.authorId) throw new ForbiddenError("정리본은 요청자만 고칠 수 있어요.");
    if (t.status !== "queued" && t.status !== "assigned") {
      throw new SummaryNotEditableError("담당자가 일을 시작한 뒤에는 정리본을 고칠 수 없어요. 보충할 내용은 댓글로 남겨 주세요.");
    }
    if (!markdown) throw new SummaryNotEditableError("정리본 내용을 입력해 주세요.");
    const [s] = await tx.select().from(ticketSummaries).where(eq(ticketSummaries.ticketId, t.id));
    if (!s) throw new SummaryNotEditableError("아직 정리본이 없어요. 잠시 뒤에 다시 시도해 주세요.");
    await tx
      .update(ticketSummaries)
      .set({ markdown, editedBy: input.actor.userId, editedAt: new Date() })
      .where(eq(ticketSummaries.ticketId, t.id));
    const [event] = await tx
      .insert(ticketEvents)
      .values({
        ticketId: t.id,
        actorId: input.actor.userId,
        actorKind: "user",
        type: "summary_edited",
        from: { markdown: s.markdown },
        to: { markdown },
      })
      .returning();
    await emitNotifications(tx, event, t);
  });
}
