import type { MemberRole } from "@/lib/auth-roles";
import type { CloseReason, TicketStatus, WithdrawKind } from "@/lib/db/schema/tickets";
import type { Target } from "./targets";

export type {
  Category,
  CloseReason,
  ReviewStage,
  TicketStatus,
  Urgency,
  WithdrawKind,
} from "@/lib/db/schema/tickets";
export type { Target } from "./targets";

export type TicketAction =
  | { type: "requestReview" }
  | { type: "stageReady" }
  | { type: "stageFailed" }
  | { type: "continueReview" }
  | { type: "withdraw"; kind: WithdrawKind }
  | { type: "submit"; target: Target }
  | { type: "accept" }
  | { type: "claim" }
  | { type: "assignTarget"; target: Target }
  | { type: "transfer"; target: Target; reason: string }
  | { type: "hold"; reason: string }
  | { type: "resume" }
  | { type: "resolve"; linkedRefs?: string[] }
  | { type: "confirmFixed" }
  | { type: "reopen"; reason: string }
  | { type: "close"; reason: CloseReason; note?: string; duplicateOfId?: string }
  | { type: "reopenClosed"; reason?: string };

export type ActionType = TicketAction["type"];

export type ActorCtx = {
  userId: string | null;
  role: MemberRole | "system";
  /** 행위자가 속한 이 프로젝트의 그룹 id들 */
  groupIds: string[];
};

/**
 * 상태 기계가 보는 티켓의 모양.
 * `lastAssigneeId`는 선택 필드: `reopenClosed`가 "이전 담당자"를 알아야 하는데
 * 이 함수는 DB를 조회하지 않으므로, 호출자(서비스)가 종결 직전 담당자
 * (ticket_events에서 구한 값)를 넣어 준다. 없으면 assigneeId(close가 비우지 않음)를 쓰고, 그것도 없으면 리드 큐로 돌아간다.
 */
export type TicketShape = {
  status: TicketStatus;
  authorId: string;
  targetUserId: string | null;
  targetGroupId: string | null;
  assigneeId: string | null;
  lastAssigneeId?: string | null;
};

export type TicketPatch = Partial<{
  status: TicketStatus;
  targetUserId: string | null;
  targetGroupId: string | null;
  assigneeId: string | null;
  withdrawKind: WithdrawKind | null;
  closeReason: CloseReason | null;
  closeNote: string | null;
  duplicateOfId: string | null;
}>;

export type TransitionErrorCode = "invalid_transition" | "forbidden" | "reason_required";

export class TransitionError extends Error {
  constructor(
    public readonly code: TransitionErrorCode,
    message?: string,
  ) {
    super(`${code}: ${message ?? DEFAULT_MESSAGES[code]}`);
    this.name = "TransitionError";
  }
}

const DEFAULT_MESSAGES: Record<TransitionErrorCode, string> = {
  invalid_transition: "지금 상태에서는 할 수 없는 작업이에요.",
  forbidden: "이 작업을 할 권한이 없어요.",
  reason_required: "사유를 적어 주세요.",
};

/** 대상 → 상태·대상 필드. 사람은 `assigned`, 그룹/null은 `queued`. */
export function placeByTarget(target: Target): TicketPatch {
  if (target === null) {
    return { status: "queued", targetUserId: null, targetGroupId: null };
  }
  if (target.kind === "user") {
    return { status: "assigned", targetUserId: target.userId, targetGroupId: null, assigneeId: null };
  }
  return { status: "queued", targetGroupId: target.groupId, targetUserId: null };
}

// ---------- 주체 판별 ----------

const isStaff = (a: ActorCtx) => a.role === "lead" || a.role === "developer";
const isLead = (a: ActorCtx) => a.role === "lead" && a.userId !== null;
const isSystem = (a: ActorCtx) => a.role === "system";
const isAuthor = (t: TicketShape, a: ActorCtx) => a.userId !== null && a.userId === t.authorId;
/** 지정된 대상 사람(assigned 상태에서만 의미가 있다). */
const isTargetPerson = (t: TicketShape, a: ActorCtx) =>
  isStaff(a) && t.status === "assigned" && a.userId !== null && a.userId === t.targetUserId;
/**
 * R1: "담당자" = assigneeId, 또는 assigned 상태에서의 targetUserId.
 */
const isAssignee = (t: TicketShape, a: ActorCtx) =>
  isStaff(a) &&
  a.userId !== null &&
  (a.userId === t.assigneeId || (t.status === "assigned" && a.userId === t.targetUserId));
const isGroupMember = (t: TicketShape, a: ActorCtx) =>
  isStaff(a) && t.targetGroupId !== null && a.groupIds.includes(t.targetGroupId);
const isLeadQueue = (t: TicketShape) =>
  t.status === "queued" && t.targetGroupId === null && t.targetUserId === null;

// ---------- 종결 사유별 허용 주체 ----------

const CLOSE_REASONS: readonly CloseReason[] = [
  "resolved_confirmed",
  "wont_do",
  "duplicate",
  "requester_withdrawn",
  "other",
];

const CLOSE_ALLOW: Record<CloseReason, (t: TicketShape, a: ActorCtx) => boolean> = {
  resolved_confirmed: (t, a) => isAuthor(t, a) || isAssignee(t, a) || isLead(a),
  wont_do: (_t, a) => isLead(a),
  duplicate: (t, a) => isAssignee(t, a) || isLead(a),
  requester_withdrawn: (t, a) => isAuthor(t, a),
  other: (_t, a) => isLead(a),
};

// ---------- 전이 표(데이터) ----------

type Rule<K extends ActionType> = {
  /** 허용되는 현재 상태 */
  from: readonly TicketStatus[];
  /** 상태 외 추가 조건(예: 리드 큐인가) */
  when?: (t: TicketShape) => boolean;
  /**
   * 허용 주체. `action`이 없으면 availableActions 질의이며,
   * 허용되는 변형이 하나라도 있으면 true.
   */
  who: (t: TicketShape, a: ActorCtx, action?: Extract<TicketAction, { type: K }>) => boolean;
  /** 사유 등 입력 검증 (reason_required 던짐) */
  check?: (action: Extract<TicketAction, { type: K }>) => void;
  /** 결과 패치 */
  apply: (t: TicketShape, a: ActorCtx, action: Extract<TicketAction, { type: K }>) => TicketPatch;
};

const blank = (s: string | undefined | null) => !s || s.trim() === "";
const needReason = (s: string | undefined | null, msg = "사유를 적어 주세요.") => {
  if (blank(s)) throw new TransitionError("reason_required", msg);
};

const PRE_SUBMIT: readonly TicketStatus[] = ["draft", "ai_reviewing", "awaiting_requester"];
const OPEN_STATES: readonly TicketStatus[] = ["queued", "assigned", "in_progress", "on_hold", "resolved"];

/** 이전 담당자: lastAssigneeId가 있으면 그것, 없으면 close가 비우지 않은 assigneeId. */
const prev = (t: TicketShape) => t.lastAssigneeId ?? t.assigneeId;

type Table = { [K in ActionType]: Rule<K>[] };

export const TRANSITIONS: Table = {
  requestReview: [
    {
      from: ["draft"],
      who: isAuthor,
      apply: () => ({ status: "ai_reviewing" }),
    },
  ],
  stageReady: [
    { from: ["ai_reviewing"], who: (_t, a) => isSystem(a), apply: () => ({ status: "awaiting_requester" }) },
  ],
  stageFailed: [
    { from: ["ai_reviewing"], who: (_t, a) => isSystem(a), apply: () => ({ status: "awaiting_requester" }) },
  ],
  continueReview: [
    { from: ["awaiting_requester"], who: isAuthor, apply: () => ({ status: "ai_reviewing" }) },
  ],
  withdraw: [
    {
      from: ["awaiting_requester"],
      who: isAuthor,
      apply: (_t, _a, x) => ({ status: "withdrawn_ai_resolved", withdrawKind: x.kind }),
    },
  ],
  submit: [{ from: PRE_SUBMIT, who: isAuthor, apply: (_t, _a, x) => placeByTarget(x.target) }],
  accept: [
    {
      from: ["assigned"],
      who: isTargetPerson,
      apply: (_t, a) => ({ status: "in_progress", assigneeId: a.userId }),
    },
  ],
  claim: [
    {
      // 그룹 큐: 그룹원 또는 lead
      from: ["queued"],
      when: (t) => t.targetGroupId !== null,
      who: (t, a) => isGroupMember(t, a) || isLead(a),
      apply: (_t, a) => ({ status: "in_progress", assigneeId: a.userId }),
    },
    {
      // 리드 큐: lead만
      from: ["queued"],
      when: isLeadQueue,
      who: (_t, a) => isLead(a),
      apply: (_t, a) => ({ status: "in_progress", assigneeId: a.userId }),
    },
  ],
  assignTarget: [
    {
      from: ["queued"],
      when: isLeadQueue,
      who: (_t, a) => isLead(a),
      apply: (_t, _a, x) => placeByTarget(x.target),
    },
  ],
  transfer: [
    {
      from: ["assigned", "queued", "in_progress"],
      who: (t, a) =>
        isLead(a) ||
        isTargetPerson(t, a) ||
        (t.status === "in_progress" && isAssignee(t, a)) ||
        (t.status === "queued" && isGroupMember(t, a)),
      check: (x) => needReason(x.reason, "이관 사유를 적어 주세요."),
      apply: (_t, _a, x) => ({ ...placeByTarget(x.target), assigneeId: null }),
    },
  ],
  hold: [
    {
      from: ["in_progress"],
      who: isAssignee,
      check: (x) => needReason(x.reason, "보류 사유를 적어 주세요."),
      apply: () => ({ status: "on_hold" }),
    },
  ],
  resume: [{ from: ["on_hold"], who: isAssignee, apply: () => ({ status: "in_progress" }) }],
  resolve: [{ from: ["in_progress"], who: isAssignee, apply: () => ({ status: "resolved" }) }],
  confirmFixed: [
    {
      from: ["resolved"],
      who: isAuthor,
      apply: () => ({ status: "closed", closeReason: "resolved_confirmed" }),
    },
  ],
  reopen: [
    {
      from: ["resolved"],
      who: isAuthor,
      check: (x) => needReason(x.reason, "다시 여는 사유를 적어 주세요."),
      apply: () => ({ status: "in_progress" }),
    },
  ],
  close: [
    {
      from: OPEN_STATES,
      who: (t, a, x) =>
        x ? CLOSE_ALLOW[x.reason]?.(t, a) === true : CLOSE_REASONS.some((r) => CLOSE_ALLOW[r](t, a)),
      check: (x) => {
        if (!CLOSE_REASONS.includes(x.reason)) throw new TransitionError("invalid_transition", "알 수 없는 종결 사유예요.");
        if (x.reason === "duplicate") needReason(x.duplicateOfId, "중복 대상 티켓을 골라 주세요.");
        if (x.reason === "other") needReason(x.note, "종결 사유를 적어 주세요.");
      },
      apply: (_t, _a, x) => ({
        status: "closed",
        closeReason: x.reason,
        closeNote: blank(x.note) ? null : x.note!.trim(),
        duplicateOfId: x.reason === "duplicate" ? x.duplicateOfId!.trim() : null,
      }),
    },
  ],
  reopenClosed: [
    {
      from: ["closed"],
      who: (_t, a) => isLead(a),
      apply: (t) => ({
        ...placeByTarget(prev(t) ? { kind: "user", userId: prev(t)! } : null),
        assigneeId: null,
        closeReason: null,
        closeNote: null,
        duplicateOfId: null,
      }),
    },
  ],
};

function matching<K extends ActionType>(t: TicketShape, type: K): Rule<K>[] {
  return (TRANSITIONS[type] as Rule<K>[]).filter((r) => r.from.includes(t.status) && (!r.when || r.when(t)));
}

/**
 * 순수 함수. 허용되면 티켓에 적용할 변경분을 돌려주고, 아니면 TransitionError.
 * 검사 순서: 상태(invalid_transition) → 주체(forbidden) → 입력(reason_required).
 */
export function applyAction(t: TicketShape, action: TicketAction, actor: ActorCtx): TicketPatch {
  const rules = matching(t, action.type) as Rule<typeof action.type>[];
  if (rules.length === 0) throw new TransitionError("invalid_transition");
  const rule = rules.find((r) => (r.who as Rule<ActionType>["who"])(t, actor, action as never));
  if (!rule) throw new TransitionError("forbidden");
  rule.check?.(action as never);
  return rule.apply(t, actor, action as never);
}

/** 이 행위자가 지금 할 수 있는 동작 종류. 변형이 하나라도 허용되면 포함한다. */
export function availableActions(t: TicketShape, actor: ActorCtx): ActionType[] {
  return (Object.keys(TRANSITIONS) as ActionType[]).filter((type) =>
    matching(t, type).some((r) => (r.who as Rule<ActionType>["who"])(t, actor, undefined)),
  );
}
