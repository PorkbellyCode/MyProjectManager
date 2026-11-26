import { and, eq, ne, sql } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { submittedOnly } from "./visibility";
import { tickets, user } from "@/lib/db/schema";
import type { CloseReason, TicketStatus } from "@/lib/db/schema/tickets";

export type SimilarTicket = {
  id: string;
  number: number;
  title: string;
  status: TicketStatus;
  closeReason: CloseReason | null;
  assigneeName: string | null;
  updatedAt: Date;
  /** 티켓에 연결된 커밋·PR 참조. 현재 스키마에는 이런 칸이 없어 항상 빈 배열이다. */
  linkedRefs: string[];
  rank: number;
};

/** 같은 프로젝트의 제출된 티켓(R24: 초안·검토 중·제출 없이 철회된 티켓 제외)을 전문 검색으로 찾는다. */
export async function searchSimilarTickets(
  db: Db,
  projectId: string,
  query: string,
  excludeId?: string,
  limit = 5,
): Promise<SimilarTicket[]> {
  if (!query.trim()) return [];
  const tsq = sql`plainto_tsquery('simple', ${query})`;
  const rank = sql<number>`ts_rank(${tickets.searchVector}, ${tsq})`;
  const rows = await db
    .select({
      id: tickets.id,
      number: tickets.number,
      title: tickets.title,
      status: tickets.status,
      closeReason: tickets.closeReason,
      assigneeName: user.name,
      updatedAt: tickets.updatedAt,
      rank,
    })
    .from(tickets)
    .leftJoin(user, eq(user.id, tickets.assigneeId))
    .where(
      and(
        eq(tickets.projectId, projectId),
        submittedOnly(),
        sql`${tickets.searchVector} @@ ${tsq}`,
        excludeId ? ne(tickets.id, excludeId) : undefined,
      ),
    )
    .orderBy(sql`${rank} desc`, sql`${tickets.updatedAt} desc`)
    .limit(limit);
  return rows.map((r) => ({ ...r, rank: Number(r.rank), linkedRefs: [] }));
}
