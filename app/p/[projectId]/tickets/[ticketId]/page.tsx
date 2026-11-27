import { cache, Suspense } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { getSessionUser } from "@/lib/auth";
import { getTicketDetail, type TicketDetail } from "@/lib/tickets/detail";
import { isSubmittedStatus } from "@/lib/tickets/visibility";
import { CATEGORY_LABEL, CLOSE_REASON_LABEL, STATUS_LABEL, ticketRef, URGENCY_LABEL, URGENCY_LEVEL, WITHDRAW_LABEL } from "@/lib/tickets/labels";
import { fadeUpDelay } from "@/lib/motion";
import { PageFallback } from "@/components/app-shell/page-frame";
import { Poller } from "@/components/review/poller";
import { ReviewProgress } from "@/components/review/progress";
import { DuplicateCard, type DuplicatePayload } from "@/components/review/duplicate-card";
import { ResolutionCard, type ResolutionPayload } from "@/components/review/resolution-card";
import { QuestionRound, type QuestionsPayload } from "@/components/review/question-round";
import { ReadyCard, type ReadyPayload } from "@/components/review/ready-card";
import { FailedCard } from "@/components/review/failed-card";
import { DraftCard } from "@/components/review/draft-card";
import { describeTarget } from "@/lib/tickets/target-label";
import { StatusText } from "@/components/ticket/status-badge";
import { MarkdownView } from "@/components/ticket/markdown";
import { SummaryPanel } from "@/components/ticket/summary-panel";
import { Timeline } from "@/components/ticket/timeline";
import { CommentBox } from "@/components/ticket/comment-box";
import { CloseDialog } from "@/components/ticket/close-dialog";
import { ConfirmCard } from "@/components/ticket/confirm-card";
import { TicketChip } from "@/components/ticket/ticket-chip";
import { UrgencyBars } from "@/components/ticket/urgency-bars";
import { ActionsPanel } from "@/components/ticket/actions-panel";
import { LiveAnnouncer } from "@/components/ticket/live-announcer";
import { BackToList } from "@/components/ticket/back-to-list";

// 메타데이터와 화면이 같은 요청 안에서 한 번만 읽도록 묶는다.
const loadDetail = cache(async (projectId: string, ticketId: string) => {
  const user = await getSessionUser();
  if (!user) return { user: null, detail: null };
  return { user, detail: await getTicketDetail(db, { projectId, ticketId, userId: user.id }) };
});

/** 탭 제목: "#12 제목 · MyProjectManager". 볼 수 없는 티켓이면 일반 제목(제목을 흘리지 않는다). */
export async function generateMetadata({ params }: PageProps<"/p/[projectId]/tickets/[ticketId]">): Promise<Metadata> {
  const { projectId, ticketId } = await params;
  const { detail } = await loadDetail(projectId, ticketId);
  if (!detail) return { title: "티켓" };
  return { title: detail.ticket.number != null ? `${ticketRef(detail.ticket.number)} ${detail.ticket.title}` : detail.ticket.title };
}


export default function TicketPage({ params }: PageProps<"/p/[projectId]/tickets/[ticketId]">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <TicketScreen params={params} />
    </Suspense>
  );
}

async function TicketScreen({ params }: { params: PageProps<"/p/[projectId]/tickets/[ticketId]">["params"] }) {
  const { projectId, ticketId } = await params;
  const { user, detail } = await loadDetail(projectId, ticketId);
  if (!user) redirect("/login");
  if (!detail) notFound();
  return <TicketView d={detail} traceBase={env.LANGFUSE_BASEURL ?? null} />;
}

function ReviewArea({ d }: { d: TicketDetail }) {
  const t = d.ticket;
  if (!d.viewer.isAuthor) {
    // 요청자 본인이 아니면 검토 카드는 보이지 않고 상태만 안내한다.
    if (t.status === "ai_reviewing" || t.status === "awaiting_requester") {
      return (
        <p className="rise rounded-[14px] border border-line bg-surface p-5 text-[15px] text-muted-text" style={fadeUpDelay(1)}>
          요청자가 AI 검토를 진행하고 있어요.
        </p>
      );
    }
    return null;
  }
  const card = { projectId: d.project.id, ticketId: t.id, version: t.version };
  if (t.status === "draft") return <DraftCard {...card} provider={d.project.provider} aiAvailable={t.aiAvailable} target={t.target} />;
  if (t.status === "ai_reviewing") {
    const provider = d.timeline.findLast((i) => i.kind === "judgment")?.actor.provider ?? d.project.provider;
    return <ReviewProgress {...card} provider={provider} stage={t.reviewStage} round={t.interviewRound} target={t.target} />;
  }
  if (t.status !== "awaiting_requester" || !d.openTurn) return null;
  const turn = d.openTurn;
  const provider = turn.provider;
  switch (turn.kind) {
    case "duplicate_candidates":
      return <DuplicateCard {...card} provider={provider} payload={turn.payload as DuplicatePayload} refs={d.refs} />;
    case "resolution":
      return <ResolutionCard {...card} provider={provider} payload={turn.payload as ResolutionPayload} refs={d.refs} repoUrl={d.project.repoUrl} />;
    case "questions":
      return <QuestionRound key={turn.id} {...card} provider={provider} payload={turn.payload as QuestionsPayload} target={t.target} />;
    case "ready":
      return <ReadyCard key={turn.id} {...card} provider={provider} payload={turn.payload as ReadyPayload} currentTarget={t.target} options={{ people: d.people.filter((p) => p.role !== "requester"), groups: d.groups }} />;
    case "failed":
      return <FailedCard {...card} provider={provider} target={t.target} />;
  }
}

function WithdrawnNotice({ d }: { d: TicketDetail }) {
  const t = d.ticket;
  if (t.status !== "withdrawn_ai_resolved") return null;
  const kind = t.withdrawKind ?? "joined_duplicate";
  return (
    <section aria-label="철회" className="rise flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-6" style={fadeUpDelay(1)}>
      <p className="text-base font-semibold">
        {kind === "joined_duplicate" ? "기존 티켓에 합류했어요" : `${WITHDRAW_LABEL[kind]}으로 보고 철회했어요`}
      </p>
      {d.joined ? (
        <>
          <p className="text-[15px] leading-[1.75] text-muted-text">작성하신 내용은 아래 티켓에 댓글로 붙었고, 진행 상황 알림을 같이 받아요.</p>
          <div>
            <TicketChip projectId={d.project.id} t={d.joined} />
          </div>
        </>
      ) : (
        <p className="text-[15px] leading-[1.75] text-muted-text">AI가 보여 드린 근거를 보고 직접 고르셨어요. 다시 필요하면 새 티켓을 써 주세요.</p>
      )}
    </section>
  );
}

const TURN_ANNOUNCE: Record<string, string> = {
  duplicate_candidates: "중복 확인 결과가 준비됐어요",
  resolution: "해소 확인 결과가 준비됐어요",
  questions: "질문이 준비됐어요",
  ready: "제출 준비가 됐어요",
  failed: "AI 검토에 실패했어요. 그대로 제출할 수 있어요.",
};

/** 폴링·새로 고침으로 바뀐 카드나 상태를 낭독기에 알릴 문구. 바뀔 때만 읽힌다(LiveAnnouncer). */
function announcement(d: TicketDetail): string {
  const t = d.ticket;
  const turn = d.openTurn ? TURN_ANNOUNCE[d.openTurn.kind] : undefined;
  const parts = [turn ?? `티켓 상태가 ${STATUS_LABEL[t.status]}(으)로 바뀌었어요`];
  if (d.summary) parts.push("정리본이 준비됐어요");
  return parts.join(". ");
}

function TicketView({ d, traceBase }: { d: TicketDetail; traceBase: string | null }) {
  const t = d.ticket;
  const submitted = isSubmittedStatus(t.status);
  const options = { people: d.people, groups: d.groups };
  const target = describeTarget(t.target, options);
  const assignee = t.assigneeId ? (d.people.find((p) => p.id === t.assigneeId)?.name ?? "알 수 없음") : null;
  const author = d.people.find((p) => p.id === t.authorId)?.name ?? "알 수 없음";
  const summaryProvider = d.timeline.findLast((i) => i.kind === "judgment" && i.data.role === "summarizer")?.actor.provider ?? d.project.provider;
  const waitingSummary = d.summaryPending;
  const created = new Intl.DateTimeFormat("ko-KR", { month: "long", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "Asia/Seoul" }).format(t.createdAt);
  const staff = d.viewer.role === "lead" || d.viewer.role === "developer";

  return (
    <div className="mx-auto grid w-full max-w-[1440px] lg:grid-cols-[minmax(0,1fr)_minmax(280px,340px)]">
      <Poller active={waitingSummary} />
      <LiveAnnouncer message={announcement(d)} />
      <article className="flex min-w-0 flex-col gap-8 px-6 py-10 sm:px-12">
        <header className="rise flex flex-col gap-3">
          <BackToList projectId={d.project.id} />
          <div className="flex items-center gap-2.5 font-mono text-[13px] text-faint">
            <span>{ticketRef(t.number)}</span>
            <span aria-hidden>·</span>
            <span className="font-sans">{CATEGORY_LABEL[t.category]}</span>
          </div>
          <h1 className="text-[30px] font-semibold leading-[1.35] tracking-[-0.01em] [overflow-wrap:anywhere]">{t.title}</h1>
          {/* 좁은 화면에서는 속성 패널이 맨 아래로 가므로, 핵심 값과 바로 가기를 제목 밑에 둔다. */}
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm lg:hidden">
            <StatusText status={t.status} />
            <span className="inline-flex items-center gap-1.5 text-muted-text">
              <UrgencyBars level={URGENCY_LEVEL[t.urgency]} />
              {URGENCY_LABEL[t.urgency]}
            </span>
            <span className="text-muted-text">
              {target.kind === "lead" ? "리드 큐" : target.label}
              {assignee && ` · ${assignee}`}
            </span>
            <a href="#ticket-info" className="ml-auto text-[13px] text-brand underline-offset-4 hover:underline pointer-coarse:inline-flex pointer-coarse:min-h-11 pointer-coarse:items-center">
              {staff ? "처리 · 정보로" : "정보로"}
            </a>
          </div>
        </header>

        <div className="flex flex-col gap-6 empty:hidden" style={fadeUpDelay(1)}>
          <ReviewArea d={d} />
          <WithdrawnNotice d={d} />
          {t.status === "resolved" && d.viewer.isAuthor && (
            <ConfirmCard projectId={d.project.id} ticketId={t.id} version={t.version} linkedRefs={d.linkedRefs} repoUrl={d.project.repoUrl} />
          )}
          {submitted && (d.summary || t.aiAvailable) && (
            <SummaryPanel
              projectId={d.project.id}
              ticketId={t.id}
              version={t.version}
              summary={d.summary}
              editable={d.summaryEditable}
              provider={summaryProvider}
              pending={waitingSummary}
            />
          )}
        </div>

        <section aria-label="원문" className="rise flex flex-col gap-3" style={fadeUpDelay(2)}>
          <h2 className="text-[15px] font-semibold">{submitted && d.summary ? "원문" : "본문"}</h2>
          {t.body.trim() ? <MarkdownView source={t.body} className="text-base" /> : <p className="text-sm text-faint">본문 없이 제목만 적었어요.</p>}
        </section>

        <section aria-label="활동" className="rise flex flex-col gap-2" style={fadeUpDelay(3)}>
          <h2 className="mb-2 text-[15px] font-semibold">활동</h2>
          <Timeline
            items={d.timeline}
            projectId={d.project.id}
            repoUrl={d.project.repoUrl}
            people={d.people}
            groups={d.groups}
            refs={d.refs}
            viewerRole={d.viewer.role}
            traceBase={staff ? traceBase : null}
          />
          <div className="mt-4">
            <CommentBox projectId={d.project.id} ticketId={t.id} />
          </div>
        </section>
      </article>

      <aside id="ticket-info" aria-label="티켓 정보" className="flex flex-col gap-7 border-line px-6 pb-12 sm:px-12 lg:border-l lg:px-8 lg:py-10">
        {staff && (
          <ActionsPanel
            key={`${t.id}:${t.version}`}
            projectId={d.project.id}
            ticketId={t.id}
            version={t.version}
            status={t.status}
            urgency={t.urgency}
            target={t.target}
            actions={d.actions}
            closeReasons={d.closeReasons}
            canProposeWontDo={d.canProposeWontDo}
            canSetUrgency={d.canSetUrgency}
            options={{ people: d.people.filter((p) => p.role !== "requester"), groups: d.groups }}
            recommendation={d.aiRecommendation}
            duplicateCandidate={d.duplicateCandidate}
          />
        )}
        <dl className="grid gap-[18px]">
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">상태</dt>
            <dd className="text-sm font-medium">
              <p role="status" aria-label="티켓 상태">
                <StatusText status={t.status} />
              </p>
              {t.status === "closed" && t.closeReason && (
                <span className="mt-1 block text-[13px] font-normal text-muted-text">
                  {CLOSE_REASON_LABEL[t.closeReason]}
                  {t.closeNote ? ` · ${t.closeNote}` : ""}
                </span>
              )}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">담당 대상</dt>
            <dd className="text-sm font-medium">
              {target.kind === "lead" ? "리드 큐" : target.label}
              {target.kind === "group" && <span className="ml-1.5 text-xs font-normal text-faint">그룹</span>}
            </dd>
          </div>
          {assignee && (
            <div className="flex flex-col gap-1.5">
              <dt className="text-xs text-faint">담당자</dt>
              <dd className="text-sm font-medium">{assignee}</dd>
            </div>
          )}
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">긴급도</dt>
            <dd className="flex items-center gap-2 text-sm font-medium">
              <UrgencyBars level={URGENCY_LEVEL[t.urgency]} />
              {URGENCY_LABEL[t.urgency]}
            </dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">카테고리</dt>
            <dd className="text-sm font-medium">{CATEGORY_LABEL[t.category]}</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">요청자</dt>
            <dd className="text-sm font-medium">{author}</dd>
          </div>
          <div className="flex flex-col gap-1.5">
            <dt className="text-xs text-faint">생성</dt>
            <dd className="font-mono text-[13px]">{created}</dd>
          </div>
        </dl>
        {d.canWithdraw && (
          <div className="flex flex-col gap-2 border-t border-line pt-6">
            <CloseDialog projectId={d.project.id} ticketId={t.id} version={t.version} />
            <p className="text-[13px] leading-[1.6] text-faint">더 이상 필요 없으면 언제든 회수할 수 있어요.</p>
          </div>
        )}
      </aside>
    </div>
  );
}
