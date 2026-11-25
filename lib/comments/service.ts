import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { getMembership } from "@/lib/access";
import { comments, ticketEvents, tickets } from "@/lib/db/schema";
import { emitNotifications } from "@/lib/notifications/emit";
import { TicketNotFoundError } from "@/lib/tickets/service";

export class EmptyCommentError extends Error {
  constructor(message = "댓글 내용을 적어 주세요.") {
    super(message);
    this.name = "EmptyCommentError";
  }
}

/**
 * 댓글을 단다. 프로젝트 멤버만, 빈 본문은 거부. 같은 트랜잭션에서 `commented` 이벤트와 알림을 남긴다.
 * 비멤버는 없는 티켓과 같은 `TicketNotFoundError`(404). Task 9의 "같은 건으로 합류"도 이 함수를 쓴다.
 */
export async function addComment(db: Db, input: { ticketId: string; authorId: string; body: string }) {
  const body = input.body.trim();
  if (!body) throw new EmptyCommentError();
  return db.transaction(async (tx) => {
    const [t] = await tx.select().from(tickets).where(eq(tickets.id, input.ticketId));
    if (!t) throw new TicketNotFoundError();
    const m = await getMembership(tx, t.projectId, input.authorId);
    if (!m) throw new TicketNotFoundError() // 비멤버에게는 티켓 존재를 알리지 않는다(404);
    const [comment] = await tx.insert(comments).values({ ticketId: t.id, authorId: input.authorId, body }).returning();
    const [event] = await tx
      .insert(ticketEvents)
      .values({
        ticketId: t.id,
        actorId: input.authorId,
        actorKind: "user",
        type: "commented",
        to: { commentId: comment.id },
      })
      .returning();
    await emitNotifications(tx, event, t);
    return comment;
  });
}
