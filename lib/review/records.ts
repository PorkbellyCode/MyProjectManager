import { and, asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { requiredFields, ticketAttachments, ticketReviewTurns } from "@/lib/db/schema";
import type { Category } from "@/lib/db/schema/tickets";
import { DEFAULT_REQUIRED_FIELDS, type AnsweredQuestion, type Question, type RequiredField } from "@/lib/agents/interview";

/** 관리자가 고친 목록이 있으면 그것, 없으면 기본값. */
export async function getRequiredFields(db: Db, projectId: string, category: Category): Promise<RequiredField[]> {
  const [row] = await db
    .select({ items: requiredFields.items })
    .from(requiredFields)
    .where(and(eq(requiredFields.projectId, projectId), eq(requiredFields.category, category)));
  return row?.items?.length ? row.items : DEFAULT_REQUIRED_FIELDS[category];
}

export type QuestionsPayload = { round: number; questions: Question[] };
export type AnswerRecord = { questionId: string; value: string | string[]; attachmentUrls?: string[] };
export type QuestionsResponse = { answers: AnswerRecord[] };

export type AnsweredRecord = AnsweredQuestion & { round: number; questionId: string; prompt: string; type: Question["type"] };

/** 응답이 끝난 질문 카드들에서 질문별 답변을 모은다(오래된 라운드부터). */
export async function loadAnswered(db: Db, ticketId: string): Promise<AnsweredRecord[]> {
  const rows = await db
    .select()
    .from(ticketReviewTurns)
    .where(and(eq(ticketReviewTurns.ticketId, ticketId), eq(ticketReviewTurns.kind, "questions")))
    .orderBy(asc(ticketReviewTurns.createdAt));
  const out: AnsweredRecord[] = [];
  for (const row of rows) {
    if (!row.respondedAt) continue;
    const payload = row.payload as QuestionsPayload;
    const response = row.response as QuestionsResponse | null;
    for (const a of response?.answers ?? []) {
      const q = payload.questions.find((x) => x.id === a.questionId);
      if (!q) continue;
      out.push({
        round: payload.round,
        questionId: q.id,
        fillsKey: q.fillsKey,
        prompt: q.prompt,
        type: q.type,
        value: a.value,
        ...(a.attachmentUrls?.length ? { attachmentUrls: a.attachmentUrls } : {}),
      });
    }
  }
  return out;
}

export async function ticketHasAttachments(db: Db, ticketId: string): Promise<boolean> {
  const rows = await db.select({ id: ticketAttachments.id }).from(ticketAttachments).where(eq(ticketAttachments.ticketId, ticketId)).limit(1);
  return rows.length > 0;
}

/** 모델에 넘기는 인터뷰 기록(질문과 답). */
export function renderAnswered(answered: AnsweredRecord[]): string {
  if (answered.length === 0) return "(아직 인터뷰 답변이 없어요)";
  return answered
    .map((a) => {
      const v = a.value === "unknown" ? "모르겠어요" : Array.isArray(a.value) ? a.value.join(", ") : a.value;
      const files = a.attachmentUrls?.length ? ` [첨부 ${a.attachmentUrls.length}개]` : "";
      return `- (라운드 ${a.round}, ${a.fillsKey}) ${a.prompt} → ${v || "(첨부만)"}${files}`;
    })
    .join("\n");
}
