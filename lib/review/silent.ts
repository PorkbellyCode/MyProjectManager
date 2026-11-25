import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { aiJudgments, ticketEvents, tickets } from "@/lib/db/schema";
import type { ReviewStage } from "@/lib/db/schema/tickets";
import { getActiveProfile, type AgentProfile, type AgentRole } from "@/lib/agents/profiles";
import {
  checkDuplicates,
  checkRecommendation,
  checkResolution,
  insertJudgment,
  type JudgmentBase,
  type ReviewDeps,
} from "@/lib/review/pipeline";
import { summarizeTicket } from "@/lib/review/summary";
import type { Ticket } from "@/lib/tickets/service";

const NOT_SUBMITTED = new Set(["draft", "ai_reviewing", "awaiting_requester", "withdrawn_ai_resolved"]);

const note = (ticketId: string, to: Record<string, unknown>, reason: string) => ({
  ticketId,
  actorId: null,
  actorKind: "ai" as const,
  type: "ai_note",
  to,
  reason,
});

/**
 * 바로 제출한 티켓의 조용한 검토. 요청자에게는 아무것도 묻거나 보여 주지 않는다.
 * 중복 확인, 해소 확인, 대상 추천을 돌려 결과를 이벤트 `ai_note`(비고)로만 남기고, 티켓의 상태·대상·긴급도는 바꾸지 않는다. 이어서 정리본을 만든다.
 * - 한 단계가 실패해도 나머지는 계속한다(판단 `failed`만 남는다).
 * - 정리본이 실패해 작업이 재시도돼도 비고가 두 번 남지 않도록, 추천 판단이 이미 있으면 비고 단계는 건너뛴다.
 */
export async function runSilentReview(db: Db, ticketId: string, deps: ReviewDeps = {}): Promise<void> {
  const [t] = await db.select().from(tickets).where(eq(tickets.id, ticketId));
  if (!t || NOT_SUBMITTED.has(t.status)) return;
  const [done] = await db
    .select({ id: aiJudgments.id })
    .from(aiJudgments)
    .where(and(eq(aiJudgments.ticketId, ticketId), eq(aiJudgments.stage, "recommend")))
    .limit(1);
  if (!done) await leaveNotes(db, t, deps);
  await summarizeTicket(db, ticketId, deps);
}

async function leaveNotes(db: Db, t: Ticket, deps: ReviewDeps): Promise<void> {
  const profiles = new Map<AgentRole, AgentProfile | null>();
  const profileFor = async (role: AgentRole) => {
    if (!profiles.has(role)) profiles.set(role, await getActiveProfile(db, t.projectId, role).catch(() => null));
    return profiles.get(role)!;
  };
  const base = (stage: ReviewStage, role: AgentRole, profile: AgentProfile | null): JudgmentBase => ({
    projectId: t.projectId,
    ticketId: t.id,
    stage,
    role,
    profile,
    input: { title: t.title, body: t.body, category: t.category, urgency: t.urgency, silent: true },
  });

  /** 한 단계를 실행한다. 실패하면 판단 failed를 남기고 null. */
  async function step<T>(stage: ReviewStage, role: AgentRole, fn: (p: AgentProfile) => Promise<T>) {
    const profile = await profileFor(role);
    try {
      if (!profile) throw new Error(`에이전트 프로필이 없어요: ${role}`);
      return await fn(profile);
    } catch (err) {
      await insertJudgment(db, base(stage, role, profile), { status: "failed", error: err instanceof Error ? err.message : String(err) });
      return null;
    }
  }

  const dup = await step("dedup", "resolver", (p) => checkDuplicates(db, t, p, deps));
  if (dup) {
    const profile = (await profileFor("resolver"))!;
    await db.transaction(async (tx) => {
      await insertJudgment(tx, base("dedup", "resolver", profile), {
        status: "ok",
        output: dup.run.output,
        normalized: dup.payload,
        evidence: dup.ids.map((id) => ({ ref: `ticket:${id}` })),
        run: dup.run,
      });
      if (dup.payload.candidates.length > 0) {
        await tx.insert(ticketEvents).values(note(t.id, { note: "duplicate_candidates", candidates: dup.payload.candidates }, "비슷한 티켓이 있어요."));
      }
    });
  }

  const res = await step("resolve", "resolver", (p) => checkResolution(db, t, p, deps));
  if (res) {
    const profile = (await profileFor("resolver"))!;
    await db.transaction(async (tx) => {
      await insertJudgment(tx, base("resolve", "resolver", profile), {
        status: "ok",
        output: res.run.output,
        normalized: res.normalized,
        evidence: res.normalized?.evidence ?? [],
        run: res.run,
      });
      if (res.normalized) {
        await tx.insert(ticketEvents).values(note(t.id, { note: "resolution", ...res.normalized }, "이미 해결됐거나 정상 동작일 수 있어요."));
      }
    });
  }

  // 추천 판단은 마지막에 남긴다(재시도 때 비고 단계를 건너뛰는 표시).
  const rec = await step("recommend", "recommender", (p) => checkRecommendation(db, t, p, deps));
  const recProfile = await profileFor("recommender");
  if (rec) {
    await db.transaction(async (tx) => {
      await insertJudgment(tx, base("recommend", "recommender", recProfile), {
        status: "ok",
        output: rec.run.output,
        normalized: rec.rec,
        evidence: rec.rec.evidence,
        run: rec.run,
      });
      if (rec.rec.target) {
        await tx.insert(ticketEvents).values(note(t.id, { note: "target_recommendation", ...rec.rec }, "AI가 추천한 대상이에요. 대상은 바뀌지 않았어요."));
      }
    });
  }
}
