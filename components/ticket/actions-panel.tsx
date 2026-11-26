"use client";

import { Loader2 } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { AiLabel, aiScopeStyle } from "@/components/review/ai-frame";
import {
  acceptAction,
  claimAction,
  holdAction,
  proposeWontDoAction,
  reopenClosedAction,
  resumeAction,
  setUrgencyAction,
} from "@/app/p/[projectId]/tickets/actions";
import type { ActionResult } from "@/app/p/[projectId]/tickets/schemas";
import type { ActionType } from "@/lib/tickets/state-machine";
import type { CloseReason, TicketStatus, Urgency } from "@/lib/db/schema/tickets";
import type { TargetOptions } from "@/lib/tickets/detail";
import type { Target } from "@/lib/tickets/targets";
import { describeTarget } from "@/lib/tickets/target-label";
import { URGENCIES, URGENCY_LABEL, URGENCY_LEVEL } from "@/lib/tickets/labels";
import { StaffCloseDialog } from "./close-dialog";
import { AssignDialog, PanelButton, ReasonDialog, ResolveDialog, TransferDialog } from "./transfer-dialog";
import { UrgencyBars } from "./urgency-bars";
import { useTicketAction } from "./use-ticket-action";

export type ActionsPanelProps = {
  projectId: string;
  ticketId: string;
  version: number;
  status: TicketStatus;
  urgency: Urgency;
  target: Target;
  /** 서버의 availableActions 결과. 여기 없는 버튼은 그리지 않는다(서버가 다시 검사한다). */
  actions: ActionType[];
  closeReasons: CloseReason[];
  canProposeWontDo: boolean;
  canSetUrgency: boolean;
  options: TargetOptions;
  recommendation: { target: Target; reason: string; provider: string | null } | null;
  duplicateCandidate: { number: number; title: string } | null;
};

/** 버튼 하나짜리 동작(수락, 가져가기, 재개). */
function OneClick({ label, primary, run, success }: { label: string; primary?: boolean; run: () => Promise<ActionResult>; success: string }) {
  const { execute, pending } = useTicketAction();
  return (
    <PanelButton primary={primary} disabled={pending} onClick={() => void execute(run, { success })}>
      {pending && <Loader2 className="animate-spin" aria-hidden />}
      {label}
    </PanelButton>
  );
}

/** 강조색 버튼은 화면에 하나만: 지금 상태에서 가장 앞선 동작. */
const PRIMARY_ORDER: ActionType[] = ["assignTarget", "accept", "claim", "resume", "resolve", "reopenClosed"];

/**
 * 상세 화면 오른쪽의 처리 패널(개발자·리드). 버튼은 서버가 계산한 availableActions로만 그린다.
 * 보류·이관·다시 열기는 사유가 필수이고, 처리 완료는 PR 번호/커밋 SHA를 선택으로 받는다.
 * 리드 큐 티켓은 조용한 검토가 남긴 AI 추천을 참고로 보이고, 대상 지정에 미리 채운다.
 */
export function ActionsPanel(p: ActionsPanelProps) {
  const has = (a: ActionType) => p.actions.includes(a);
  const primary = PRIMARY_ORDER.find(has);
  const base = { projectId: p.projectId, ticketId: p.ticketId, version: p.version };
  const v = { expectedVersion: p.version };
  const leadQueue = p.status === "queued" && p.target === null;
  const rec = leadQueue && p.recommendation ? p.recommendation : null;
  const canClose = has("close") && p.closeReasons.some((r) => r !== "requester_withdrawn");
  const buttons = [
    has("assignTarget") && (
      <AssignDialog key="assign" {...base} options={p.options} primary={primary === "assignTarget"} recommended={rec ? { target: rec.target, reason: rec.reason, provider: rec.provider } : null} />
    ),
    has("accept") && <OneClick key="accept" label="수락" primary={primary === "accept"} success="수락했어요. 진행중으로 바뀌었어요." run={() => acceptAction(p.projectId, p.ticketId, v)} />,
    has("claim") && <OneClick key="claim" label="가져가기" primary={primary === "claim"} success="가져왔어요. 진행중으로 바뀌었어요." run={() => claimAction(p.projectId, p.ticketId, v)} />,
    has("resume") && <OneClick key="resume" label="재개" primary={primary === "resume"} success="다시 진행해요." run={() => resumeAction(p.projectId, p.ticketId, v)} />,
    has("resolve") && <ResolveDialog key="resolve" {...base} primary={primary === "resolve"} />,
    has("reopenClosed") && (
      <ReasonDialog
        key="reopenClosed"
        trigger="다시 열기"
        primary={primary === "reopenClosed"}
        title="종결된 티켓을 다시 열까요?"
        description="이전 담당자가 있으면 그 사람에게, 없으면 리드 큐로 돌아가요."
        label="다시 여는 사유"
        submit="다시 열기"
        required="다시 여는 사유를 적어 주세요."
        success="티켓을 다시 열었어요."
        run={(reason) => reopenClosedAction(p.projectId, p.ticketId, { ...v, reason })}
      />
    ),
    has("hold") && (
      <ReasonDialog
        key="hold"
        trigger="보류"
        title="보류할까요?"
        description="보류 중에는 처리가 멈춰요. 요청자에게 사유와 함께 알림이 가요."
        label="보류 사유"
        placeholder="예: 디자인 확정을 기다려요"
        submit="보류하기"
        required="보류 사유를 적어 주세요."
        success="보류했어요."
        run={(reason) => holdAction(p.projectId, p.ticketId, { ...v, reason })}
      />
    ),
    has("transfer") && <TransferDialog key="transfer" {...base} current={p.target} options={p.options} />,
    canClose && <StaffCloseDialog key="close" {...base} reasons={p.closeReasons} duplicateCandidate={p.duplicateCandidate} />,
    p.canProposeWontDo && (
      <ReasonDialog
        key="propose"
        trigger="안 하기로 함 제안"
        title="안 하기로 하자고 제안할까요?"
        description="티켓은 그대로 두고 리드에게 제안이 가요. 종결은 리드가 정해요."
        label="제안 사유"
        submit="제안하기"
        required="제안 사유를 적어 주세요."
        success="리드에게 제안했어요."
        run={(reason) => proposeWontDoAction(p.projectId, p.ticketId, { ...v, reason })}
      />
    ),
  ].filter(Boolean);

  if (buttons.length === 0 && !p.canSetUrgency && !rec) return null;

  return (
    <section aria-label="처리" className="rise flex flex-col gap-3">
      {rec && (
        <div className="ai-scope flex flex-col gap-1.5 rounded-[14px] border border-ai-ring bg-ai-tint p-4 text-[13px] leading-[1.6]" style={aiScopeStyle(rec.provider)}>
          <AiLabel provider={rec.provider} suffix="추천 · 참고" className="text-[13px]" />
          <p className="font-medium text-text">{describeTarget(rec.target, p.options).label}</p>
          {rec.reason && <p className="text-muted-text">{rec.reason}</p>}
        </div>
      )}
      {buttons.length > 0 && <div className="flex flex-col gap-2">{buttons}</div>}
      {p.canSetUrgency && <UrgencyMenu {...base} urgency={p.urgency} />}
    </section>
  );
}

function UrgencyMenu({ projectId, ticketId, version, urgency }: { projectId: string; ticketId: string; version: number; urgency: Urgency }) {
  const { execute, pending } = useTicketAction();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <PanelButton variant="ghost" className="h-9 w-full justify-between rounded-[10px] px-3 text-[13px] text-muted-text" disabled={pending}>
          <span>긴급도 바꾸기</span>
          <span className="inline-flex items-center gap-1.5 text-text">
            {pending ? <Loader2 className="size-3.5 animate-spin" aria-hidden /> : <UrgencyBars level={URGENCY_LEVEL[urgency]} />}
            {URGENCY_LABEL[urgency]}
          </span>
        </PanelButton>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44">
        <DropdownMenuLabel className="text-xs font-normal text-faint">사람만 바꿀 수 있어요</DropdownMenuLabel>
        <DropdownMenuRadioGroup
          value={urgency}
          onValueChange={(to) => {
            if (to === urgency) return;
            void execute(() => setUrgencyAction(projectId, ticketId, { expectedVersion: version, to }), { success: `긴급도를 ${URGENCY_LABEL[to as Urgency]}(으)로 바꿨어요.` });
          }}
        >
          {[...URGENCIES].reverse().map((u) => (
            <DropdownMenuRadioItem key={u} value={u} className="gap-2">
              <UrgencyBars level={URGENCY_LEVEL[u]} />
              {URGENCY_LABEL[u]}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
