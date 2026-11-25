import { asc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import {
  agentProfileVersions,
  aiJudgments,
  comments,
  projects,
  ticketEvents,
  ticketReviewTurns,
  tickets,
  user,
} from "@/lib/db/schema";

export type TimelineActor = { kind: "user" | "ai" | "system"; name?: string; provider?: string };

export type TimelineItem = {
  at: Date;
  kind: "event" | "review_turn" | "comment" | "judgment";
  actor: TimelineActor;
  data: Record<string, unknown> & { id: string };
};

/** 같은 시각일 때의 안정적인 종류 순서. */
const KIND_ORDER: Record<TimelineItem["kind"], number> = { event: 0, judgment: 1, review_turn: 2, comment: 3 };

const providerOf = (modelId: string | null | undefined) => (modelId ? modelId.split(":")[0] : undefined);

/**
 * 티켓 하나의 이벤트·AI 판단·검토 턴·댓글을 시간순으로 합친다(같은 시각이면 종류 순서, 그다음 id).
 * `discarded` 판단은 제외한다. 접근 제어(멤버 검사)는 호출하는 쪽 몫이다.
 */
export async function getTimeline(db: Db, ticketId: string): Promise<TimelineItem[]> {
  const [events, judgments, turns, notes, [proj]] = await Promise.all([
    db
      .select({ e: ticketEvents, name: user.name })
      .from(ticketEvents)
      .leftJoin(user, eq(user.id, ticketEvents.actorId))
      .where(eq(ticketEvents.ticketId, ticketId))
      .orderBy(asc(ticketEvents.createdAt)),
    db
      .select({ j: aiJudgments, modelId: agentProfileVersions.modelId, profileVersion: agentProfileVersions.version })
      .from(aiJudgments)
      .innerJoin(agentProfileVersions, eq(agentProfileVersions.id, aiJudgments.profileVersionId))
      .where(eq(aiJudgments.ticketId, ticketId)),
    db
      .select({ t: ticketReviewTurns, modelId: agentProfileVersions.modelId })
      .from(ticketReviewTurns)
      .leftJoin(aiJudgments, eq(aiJudgments.id, ticketReviewTurns.judgmentId))
      .leftJoin(agentProfileVersions, eq(agentProfileVersions.id, aiJudgments.profileVersionId))
      .where(eq(ticketReviewTurns.ticketId, ticketId)),
    db
      .select({ c: comments, name: user.name })
      .from(comments)
      .innerJoin(user, eq(user.id, comments.authorId))
      .where(eq(comments.ticketId, ticketId)),
    db
      .select({ provider: projects.defaultProvider })
      .from(tickets)
      .innerJoin(projects, eq(projects.id, tickets.projectId))
      .where(eq(tickets.id, ticketId)),
  ]);

  const items: TimelineItem[] = [
    ...events.map(({ e, name }): TimelineItem => {
      const actor: TimelineActor =
        e.actorKind === "system"
          ? { kind: "system" }
          : e.actorKind === "ai"
            ? { kind: "ai" }
            : name
              ? { kind: "user", name }
              : { kind: "user" };
      return {
        at: e.createdAt,
        kind: "event",
        actor,
        data: { id: e.id, type: e.type, actorId: e.actorId, from: e.from, to: e.to, reason: e.reason },
      };
    }),
    ...judgments
      .filter(({ j }) => j.status !== "discarded")
      .map(
        ({ j, modelId, profileVersion }): TimelineItem => ({
          at: j.createdAt,
          kind: "judgment",
          actor: { kind: "ai", provider: providerOf(modelId) },
          data: {
            id: j.id,
            role: j.role,
            stage: j.stage,
            round: j.round,
            status: j.status,
            output: j.output,
            normalized: j.normalized,
            evidence: j.evidence,
            error: j.error,
            profileVersionId: j.profileVersionId,
            profileVersion,
            modelId,
            inputTokens: j.inputTokens,
            outputTokens: j.outputTokens,
            traceId: j.traceId,
          },
        }),
      ),
    ...turns.map(
      ({ t, modelId }): TimelineItem => ({
        at: t.createdAt,
        kind: "review_turn",
        // 판단 없이 만든 카드(예: 실패 카드)는 프로젝트의 기본 제공자로 표시한다.
        actor: { kind: "ai", provider: providerOf(modelId) ?? proj?.provider },
        data: {
          id: t.id,
          stage: t.stage,
          round: t.round,
          kind: t.kind,
          payload: t.payload,
          response: t.response,
          respondedAt: t.respondedAt,
          judgmentId: t.judgmentId,
        },
      }),
    ),
    ...notes.map(
      ({ c, name }): TimelineItem => ({
        at: c.createdAt,
        kind: "comment",
        actor: { kind: "user", name },
        data: { id: c.id, authorId: c.authorId, body: c.body },
      }),
    ),
  ];

  return items.sort(
    (a, b) =>
      a.at.getTime() - b.at.getTime() ||
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      (a.data.id < b.data.id ? -1 : a.data.id > b.data.id ? 1 : 0),
  );
}
