import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { domainDocs, tickets } from "@/lib/db/schema";
import type { CloseReason, TicketStatus } from "@/lib/db/schema/tickets";
import { getLatestSnapshot } from "@/lib/agents/repo-analyst";

export type Evidence = { ref: string; note: string };

export type EvidenceCtx = {
  ticketIds: Map<string, { status: TicketStatus; closeReason: CloseReason | null }>;
  commitShas: Set<string>;
  prNumbers: Set<number>;
  docIds: Set<string>;
};

/** 이 프로젝트에 실제로 있는 티켓·커밋·PR·도메인 문서만 담는다. */
export async function loadEvidenceCtx(db: Db, projectId: string): Promise<EvidenceCtx> {
  const [ticketRows, docRows, snap] = await Promise.all([
    db
      .select({ id: tickets.id, status: tickets.status, closeReason: tickets.closeReason })
      .from(tickets)
      .where(eq(tickets.projectId, projectId)),
    db.select({ id: domainDocs.id }).from(domainDocs).where(eq(domainDocs.projectId, projectId)),
    getLatestSnapshot(db, projectId, { status: "ok" }),
  ]);
  return {
    ticketIds: new Map(ticketRows.map((t) => [t.id, { status: t.status, closeReason: t.closeReason }])),
    commitShas: new Set((snap?.facts?.commits ?? []).map((c) => c.sha)),
    prNumbers: new Set((snap?.facts?.pulls ?? []).map((p) => p.number)),
    docIds: new Set(docRows.map((d) => d.id)),
  };
}

function commitExists(sha: string, ctx: EvidenceCtx): boolean {
  if (ctx.commitShas.has(sha)) return true;
  if (sha.length < 7) return false;
  let hits = 0;
  for (const known of ctx.commitShas) if (known.startsWith(sha) && ++hits > 1) return false;
  return hits === 1;
}

function refValid(ref: string, ctx: EvidenceCtx, selfId?: string): boolean {
  const i = ref.indexOf(":");
  if (i < 0) return false;
  const kind = ref.slice(0, i);
  const value = ref.slice(i + 1);
  if (!value) return false;
  switch (kind) {
    case "ticket": {
      const t = ctx.ticketIds.get(value);
      // 제출된 티켓만 근거가 된다. 검토 중인 티켓 자신은 근거가 될 수 없다.
      return !!t && value !== selfId && t.status !== "draft" && t.status !== "withdrawn_ai_resolved";
    }
    case "commit":
      return commitExists(value, ctx);
    case "pr":
      return /^\d+$/.test(value) && ctx.prNumbers.has(Number(value));
    case "doc":
      return ctx.docIds.has(value);
    default:
      return false;
  }
}

/** 형식 오류·없는 대상·다른 프로젝트 ref를 제거한다. */
export function validEvidence(evidence: Evidence[], ctx: EvidenceCtx, selfId?: string): Evidence[] {
  return evidence.filter((e) => refValid(e.ref, ctx, selfId));
}

export function normalizeDedup(
  r: { candidates: { ticketId: string; reason: string }[] },
  ctx: EvidenceCtx,
  selfId: string,
): { candidates: { ticketId: string; reason: string }[] } {
  const seen = new Set<string>();
  const candidates: { ticketId: string; reason: string }[] = [];
  for (const c of r.candidates) {
    const t = ctx.ticketIds.get(c.ticketId);
    if (!t || c.ticketId === selfId || seen.has(c.ticketId)) continue;
    if (t.status === "draft" || t.status === "withdrawn_ai_resolved") continue;
    seen.add(c.ticketId);
    candidates.push(c);
    if (candidates.length === 3) break;
  }
  return { candidates };
}

export type ResolveResult = {
  kind: "already_resolved" | "expected_behavior";
  message: string;
  evidence: Evidence[];
  strength: "strong" | "weak";
};

export const WEAK_RESOLVE_PREFIX = "관련 변경이 있었던 것으로 보여요. ";

export function normalizeResolve(
  r: { kind: "already_resolved" | "expected_behavior" | "none"; message: string; evidence: Evidence[] },
  ctx: EvidenceCtx,
  selfId?: string,
): ResolveResult | null {
  if (r.kind === "none") return null;
  const evidence = validEvidence(r.evidence, ctx, selfId);
  if (evidence.length === 0) return null;

  if (r.kind === "expected_behavior") {
    if (!evidence.some((e) => e.ref.startsWith("doc:"))) return null;
    return { kind: r.kind, message: r.message, evidence, strength: "strong" };
  }

  const strong = evidence.some((e) => {
    if (!e.ref.startsWith("ticket:")) return false;
    return ctx.ticketIds.get(e.ref.slice("ticket:".length))?.closeReason === "resolved_confirmed";
  });
  if (strong) return { kind: r.kind, message: r.message, evidence, strength: "strong" };
  // 약한 근거는 변경(커밋·PR)이 있을 때만. 문서·열린 티켓·안 하기로 한 티켓만으로는 카드를 띄우지 않는다.
  if (!evidence.some((e) => e.ref.startsWith("commit:") || e.ref.startsWith("pr:"))) return null;
  return { kind: r.kind, message: WEAK_RESOLVE_PREFIX + r.message, evidence, strength: "weak" };
}
