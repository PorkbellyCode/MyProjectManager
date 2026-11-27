import { ExternalLink } from "lucide-react";
import { josa } from "@/lib/ko";
import type { TimelineItem } from "@/lib/tickets/timeline";
import type { GroupOption, PersonOption, TicketRefView } from "@/lib/tickets/detail";
import type { CloseReason, ReviewStage, TicketStatus, Urgency, WithdrawKind } from "@/lib/db/schema/tickets";
import type { MemberRole } from "@/lib/auth-roles";
import {
  CLOSE_REASON_LABEL,
  STAGE_NAME,
  STATUS_LABEL,
  URGENCY_LABEL,
  WITHDRAW_LABEL,
} from "@/lib/tickets/labels";
import { listStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { aiScopeStyle, providerName, Sparkle } from "@/components/review/ai-frame";
import { EvidenceLink, type EvidenceItem } from "@/components/review/evidence";
import { TicketChip } from "./ticket-chip";
import { MarkdownView } from "./markdown";

type Ctx = {
  projectId: string;
  repoUrl: string | null;
  people: PersonOption[];
  groups: GroupOption[];
  refs: Record<string, TicketRefView>;
  viewerRole: MemberRole;
  /** Langfuse 주소(설정돼 있을 때만). 리드·개발자에게만 "실행 추적 보기"를 보인다. */
  traceBase: string | null;
};

type Row = {
  key: string;
  at: Date;
  who: string;
  ai: boolean;
  system: boolean;
  provider?: string;
  initial?: string;
  what: React.ReactNode;
  body?: React.ReactNode;
  trace?: string | null;
};

const fmt = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" });

const ROLE_NAME: Record<string, string> = {
  resolver: "검토",
  lead: "인터뷰",
  recommender: "대상 추천",
  summarizer: "정리본",
  repo: "레포 분석",
};

function targetName(to: Record<string, unknown> | null | undefined, ctx: Ctx): string {
  const userId = to?.targetUserId as string | null | undefined;
  const groupId = to?.targetGroupId as string | null | undefined;
  if (userId) return ctx.people.find((p) => p.id === userId)?.name ?? "알 수 없는 사람";
  if (groupId) return `${ctx.groups.find((g) => g.id === groupId)?.name ?? "삭제된 그룹"} 그룹`;
  return "리드 큐";
}

function recTargetName(t: unknown, ctx: Ctx): string {
  const x = t as { kind?: string; userId?: string; groupId?: string } | null;
  if (!x) return "리드 큐";
  return targetName(x.kind === "user" ? { targetUserId: x.userId } : { targetGroupId: x.groupId }, ctx);
}

function Quote({ children }: { children: React.ReactNode }) {
  return <p className="whitespace-pre-wrap">{children}</p>;
}

function eventRow(item: TimelineItem, ctx: Ctx): Row | null {
  const d = item.data as { id: string; type: string; from: Record<string, unknown> | null; to: Record<string, unknown> | null; reason: string | null };
  const to = d.to ?? {};
  const from = d.from ?? {};
  const base = {
    key: d.id,
    at: item.at,
    who: item.actor.kind === "ai" ? (providerName(item.actor.provider) ?? "AI") : item.actor.kind === "system" ? "시스템" : (item.actor.name ?? "알 수 없음"),
    ai: item.actor.kind === "ai",
    system: item.actor.kind === "system",
    provider: item.actor.provider,
    initial: item.actor.name?.slice(0, 1),
  };
  const reason = d.reason?.trim() ? <Quote>{d.reason}</Quote> : undefined;
  const row = (what: React.ReactNode, body?: React.ReactNode): Row => ({ ...base, what, body });
  switch (d.type) {
    case "review_stage_changed":
    case "commented":
      return null; // 단계는 진행 표시가, 댓글은 댓글 항목이 보여 준다.
    case "created":
      return row("티켓을 작성했어요");
    case "requestReview":
      return row("AI 검토를 요청했어요");
    case "stageReady":
      return row("AI 검토 결과가 준비됐어요");
    case "stageFailed":
      return row("AI 검토가 실패했어요");
    case "continueReview":
      return row("검토를 이어 가요");
    case "withdraw":
      return row(`철회했어요 · ${WITHDRAW_LABEL[to.withdrawKind as WithdrawKind] ?? "AI 해소"}`);
    case "submit":
      return row(`제출했어요 → ${targetName(to, ctx)} · ${STATUS_LABEL[to.status as TicketStatus] ?? ""}`);
    case "accept":
      return row("수락했어요");
    case "claim":
      return row("가져갔어요");
    case "assignTarget":
      return row(`대상을 정했어요 → ${targetName(to, ctx)}`);
    case "transfer":
      return row(`이관했어요 → ${targetName(to, ctx)}`, reason);
    case "hold":
      return row("보류했어요", reason);
    case "resume":
      return row("다시 진행해요");
    case "resolve": {
      const refs = (to.linkedRefs as string[] | undefined) ?? [];
      return row(
        "처리 완료했어요",
        refs.length ? (
          <ul className="flex flex-wrap gap-2">
            {refs.map((r) => (
              <li key={r}>
                <EvidenceLink item={{ ref: r }} projectId={ctx.projectId} repoUrl={ctx.repoUrl} refs={ctx.refs} />
              </li>
            ))}
          </ul>
        ) : undefined,
      );
    }
    case "confirmFixed":
      return row("해결됐다고 확인했어요");
    case "reopen":
      return row("아직이라고 다시 열었어요", reason);
    case "close": {
      const why = CLOSE_REASON_LABEL[to.closeReason as CloseReason] ?? "종결";
      const note = (to.closeNote as string | null) ?? null;
      return row(`종결했어요 · ${why}`, note ? <Quote>{note}</Quote> : undefined);
    }
    case "reopenClosed":
      return row("종결된 티켓을 다시 열었어요", reason);
    case "urgency_changed":
      return row(`긴급도를 ${URGENCY_LABEL[from.urgency as Urgency] ?? "?"} → ${josa(URGENCY_LABEL[to.urgency as Urgency] ?? "?", "으로/로")} 바꿨어요`);
    case "summary_edited":
      return row("정리본을 고쳤어요");
    case "target_recommendation": {
      const rec = recTargetName((from as { target?: unknown }).target ?? null, ctx);
      const chosen = recTargetName((to as { target?: unknown }).target ?? null, ctx);
      return row(rec === chosen ? `보낼 곳을 확정했어요 · ${chosen} (AI 추천 그대로)` : `보낼 곳을 확정했어요 · ${chosen} (AI 추천: ${rec})`);
    }
    case "ai_note":
      return row(d.reason ?? "비고를 남겼어요", aiNoteBody(to, ctx));
    case "wont_do_proposed":
      return row("안 하기로 하자고 제안했어요", reason);
    case "group_deleted":
      return row("대상 그룹이 삭제되어 리드 큐로 옮겨졌어요");
    default:
      return row(d.type, reason);
  }
}

function aiNoteBody(to: Record<string, unknown>, ctx: Ctx): React.ReactNode {
  if (to.note === "duplicate_candidates") {
    const cs = (to.candidates as { ticketId: string; number: number | null; title: string; reason: string }[]) ?? [];
    return (
      <ul className="flex flex-col gap-2">
        {cs.map((c) => (
          <li key={c.ticketId} className="flex flex-col gap-1">
            <TicketChip projectId={ctx.projectId} t={{ id: c.ticketId, number: ctx.refs[c.ticketId]?.number ?? c.number ?? 0, title: ctx.refs[c.ticketId]?.title ?? c.title, status: ctx.refs[c.ticketId]?.status }} />
            <span>{c.reason}</span>
          </li>
        ))}
      </ul>
    );
  }
  if (to.note === "resolution") {
    const ev = (to.evidence as EvidenceItem[]) ?? [];
    return (
      <div className="flex flex-col gap-2">
        <p>{String(to.message ?? "")}</p>
        <EvidenceList items={ev} ctx={ctx} weak={to.strength === "weak"} />
      </div>
    );
  }
  if (to.note === "target_recommendation") {
    return <p>{`${recTargetName(to.target, ctx)} · ${String(to.reason ?? "")}`}</p>;
  }
  return undefined;
}

function EvidenceList({ items, ctx, weak }: { items: EvidenceItem[]; ctx: Ctx; weak?: boolean }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-2">
      {items.map((e) => (
        <li key={e.ref} className="min-w-0">
          <EvidenceLink item={e} projectId={ctx.projectId} repoUrl={ctx.repoUrl} refs={ctx.refs} weak={weak} />
        </li>
      ))}
    </ul>
  );
}

function judgmentRow(item: TimelineItem, ctx: Ctx): Row | null {
  const d = item.data as {
    id: string;
    role: string;
    stage: ReviewStage | null;
    round: number | null;
    status: string;
    error: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    traceId: string | null;
    profileVersion: number | null;
  };
  const name = d.stage ? STAGE_NAME[d.stage] : (ROLE_NAME[d.role] ?? d.role);
  const label = `${name}${d.round ? ` 라운드 ${d.round}` : ""}`;
  const staff = ctx.viewerRole === "lead" || ctx.viewerRole === "developer";
  const tokens = d.inputTokens != null ? `토큰 ${d.inputTokens}+${d.outputTokens ?? 0}` : null;
  return {
    key: d.id,
    at: item.at,
    who: providerName(item.actor.provider) ?? "AI",
    ai: true,
    system: false,
    provider: item.actor.provider,
    what: (
      <>
        {d.status === "failed" ? `${label} 판단에 실패했어요` : `${label} 판단을 마쳤어요`}
        {staff && (d.profileVersion || tokens) && (
          <span className="ml-2 font-mono text-xs text-faint">
            {[d.profileVersion ? `지시사항 v${d.profileVersion}` : null, tokens].filter(Boolean).join(" · ")}
          </span>
        )}
      </>
    ),
    body: staff && d.status === "failed" && d.error ? <Quote>{d.error}</Quote> : undefined,
    trace: staff && d.traceId && ctx.traceBase ? `${ctx.traceBase.replace(/\/$/, "")}/trace/${encodeURIComponent(d.traceId)}` : null,
  };
}

function turnRow(item: TimelineItem, ctx: Ctx): Row | null {
  const d = item.data as { id: string; kind: string; round: number | null; payload: unknown; response: unknown };
  const base = { key: d.id, at: item.at, who: providerName(item.actor.provider) ?? "AI", ai: true, system: false, provider: item.actor.provider };
  const response = d.response as Record<string, unknown> | null;
  switch (d.kind) {
    case "duplicate_candidates": {
      const p = d.payload as { candidates: { ticketId: string; number: number | null; title: string; reason: string }[] };
      const answer = response ? (response.choice === "same" ? "요청자: 같은 건이에요" : "요청자: 다른 건이에요") : null;
      return {
        ...base,
        what: `같은 건일 수 있는 티켓 ${p.candidates.length}건을 찾았어요`,
        body: (
          <div className="flex flex-col gap-2">
            <ul className="flex flex-col gap-2">
              {p.candidates.map((c) => (
                <li key={c.ticketId} className="flex flex-col gap-1">
                  <TicketChip projectId={ctx.projectId} t={{ id: c.ticketId, number: ctx.refs[c.ticketId]?.number ?? c.number ?? 0, title: ctx.refs[c.ticketId]?.title ?? c.title, status: ctx.refs[c.ticketId]?.status }} />
                  <span>{c.reason}</span>
                </li>
              ))}
            </ul>
            {answer && <p className="text-muted-text">{answer}</p>}
          </div>
        ),
      };
    }
    case "resolution": {
      const p = d.payload as { kind: WithdrawKind; message: string; evidence: EvidenceItem[]; strength: string };
      const choice = { resolved: "해결됐어요", continue: "인터뷰 계속", submit: "그대로 제출" }[String(response?.choice ?? "")] ?? null;
      return {
        ...base,
        what: `${WITHDRAW_LABEL[p.kind] ?? "해소"}일 수 있다고 알려 드렸어요`,
        body: (
          <div className="flex flex-col gap-2">
            <p>{p.message}</p>
            <EvidenceList items={p.evidence} ctx={ctx} weak={p.strength === "weak"} />
            {choice && <p className="text-muted-text">요청자: {choice}</p>}
          </div>
        ),
      };
    }
    case "questions": {
      const p = d.payload as { round: number; questions: { id: string; prompt: string; type: string }[] };
      const answers = new Map(((response?.answers as { questionId: string; value: string | string[]; attachmentUrls?: string[] }[]) ?? []).map((a) => [a.questionId, a]));
      return {
        ...base,
        what: `라운드 ${p.round} 질문 ${p.questions.length}개를 드렸어요`,
        body: (
          <dl className="grid gap-2">
            {p.questions.map((q) => {
              const a = answers.get(q.id);
              const v = !a ? (response ? "답하지 않음" : "답변 대기") : a.value === "unknown" ? "모르겠어요" : Array.isArray(a.value) ? a.value.join(", ") : a.value || (a.attachmentUrls?.length ? `이미지 ${a.attachmentUrls.length}개` : "");
              return (
                <div key={q.id} className="flex flex-col">
                  <dt className="text-muted-text">{q.prompt}</dt>
                  <dd className="font-medium">{v}</dd>
                </div>
              );
            })}
          </dl>
        ),
      };
    }
    case "ready": {
      const p = d.payload as { target: unknown; reason: string; evidence: EvidenceItem[] };
      return {
        ...base,
        what: p.target ? `맡을 곳을 추천했어요 · ${recTargetName(p.target, ctx)}` : "추천할 대상을 찾지 못했어요",
        body: p.target && p.reason ? <p>{p.reason}</p> : undefined,
      };
    }
    case "failed":
      return { ...base, what: "AI 검토에 실패했어요" };
    default:
      return null;
  }
}

function commentRow(item: TimelineItem): Row {
  const d = item.data as { id: string; body: string };
  return {
    key: d.id,
    at: item.at,
    who: item.actor.name ?? "알 수 없음",
    ai: false,
    system: false,
    initial: item.actor.name?.slice(0, 1),
    what: "댓글",
    body: <MarkdownView source={d.body} className="text-sm" />,
  };
}

/**
 * 티켓 활동 전체(이벤트·AI 판단·검토 카드·댓글). AI 항목은 원 안의 ✦ + 제공자 이름 + 연한 바탕(디자인 규칙 4),
 * 사람은 이름 첫 글자. 리드·개발자에게는 판단의 지시사항 버전·토큰과 (있으면) "실행 추적 보기"가 보인다.
 */
export function Timeline({ items, ...ctx }: Ctx & { items: TimelineItem[] }) {
  const rows = items
    .map((item) => {
      if (item.kind === "event") return eventRow(item, ctx);
      if (item.kind === "judgment") return judgmentRow(item, ctx);
      if (item.kind === "review_turn") return turnRow(item, ctx);
      return commentRow(item);
    })
    .filter((r): r is Row => r !== null);

  if (rows.length === 0) return <p className="text-sm text-faint">아직 활동이 없어요.</p>;

  return (
    <ol className="flex flex-col">
      {rows.map((r, i) => (
        <li
          key={r.key}
          className={cn("rise flex gap-3.5 py-3", r.ai && "ai-scope")}
          style={{ ...(r.ai ? aiScopeStyle(r.provider) : undefined), ...listStagger(i, 0.03) }}
        >
          <div
            aria-hidden
            className={cn(
              "flex size-7 shrink-0 items-center justify-center rounded-full text-xs font-semibold",
              r.ai ? "bg-ai-tint text-ai-text ring-1 ring-ai-ring" : r.system ? "bg-sunken text-faint" : "bg-sunken text-text",
            )}
          >
            {r.ai ? <Sparkle className="size-3.5" /> : r.system ? <span className="size-1.5 rounded-full bg-faint" /> : r.initial}
          </div>
          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm">
              <span className={cn("font-semibold", r.ai ? "text-ai-text" : r.system ? "text-muted-text" : "text-text")}>
                {r.ai && <span className="sr-only">AI </span>}
                {r.who}
              </span>
              <span className="text-muted-text">{r.what}</span>
              <time dateTime={r.at.toISOString()} className="font-mono text-xs text-faint">
                {fmt.format(r.at)}
              </time>
              {r.trace && (
                <a href={r.trace} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-ai-text underline underline-offset-2">
                  실행 추적 보기
                  <ExternalLink className="size-3" aria-hidden />
                </a>
              )}
            </div>
            {r.body && (
              <div className={cn("rounded-[10px] px-3.5 py-3 text-sm leading-[1.7]", r.ai ? "border border-ai-ring bg-ai-tint" : "bg-sunken")}>{r.body}</div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
