import { createLoader, parseAsArrayOf, parseAsStringLiteral } from "nuqs/server";
import type { MemberRole } from "@/lib/auth-roles";
import type { TicketStatus, Urgency } from "@/lib/db/schema/tickets";

/**
 * 목록 뷰와 필터(URL `?view=group&urgency=high,urgent&status=queued`). 서버(page)와 클라이언트(nuqs)가 같은 파서를 쓴다.
 * `nuqs/server`에서 가져와 "use client" 경계 없이 양쪽에서 import할 수 있다. DB 접근 없음.
 */

export const VIEWS = ["mine", "group", "lead", "confirm", "all", "requested"] as const;
export type TicketView = (typeof VIEWS)[number];

export const VIEW_LABEL: Record<TicketView, string> = {
  mine: "내 티켓",
  group: "내 그룹 큐",
  lead: "리드 큐",
  confirm: "확인 대기",
  all: "전체",
  requested: "내 요청",
};

export const VIEW_HINT: Record<TicketView, string> = {
  mine: "내가 대상이거나 담당자인 티켓",
  group: "내가 속한 그룹으로 들어온, 아직 아무도 가져가지 않은 티켓",
  lead: "대상이 비어 리드가 정해야 하는 티켓",
  confirm: "처리가 끝나 요청자 확인을 기다리는 티켓",
  all: "이 프로젝트에 제출된 모든 티켓",
  requested: "내가 작성한 티켓(작성 중인 것 포함)",
};

/** 역할별로 보이는 탭(순서 = 화면 순서). */
export function viewsFor(role: MemberRole): TicketView[] {
  if (role === "lead") return ["mine", "group", "lead", "confirm", "all", "requested"];
  if (role === "developer") return ["mine", "group", "confirm", "all", "requested"];
  return ["requested", "confirm", "all"];
}

export const defaultView = (role: MemberRole): TicketView => (role === "requester" ? "requested" : "mine");

/** 목록 필터에 쓰는 상태(작성·검토 단계는 뺀다). */
export const FILTER_STATUSES = ["queued", "assigned", "in_progress", "on_hold", "resolved", "closed"] as const satisfies readonly TicketStatus[];
export const FILTER_URGENCIES = ["low", "normal", "high", "urgent"] as const satisfies readonly Urgency[];

export const listParsers = {
  view: parseAsStringLiteral(VIEWS),
  urgency: parseAsArrayOf(parseAsStringLiteral(FILTER_URGENCIES)).withDefault([]),
  status: parseAsArrayOf(parseAsStringLiteral(FILTER_STATUSES)).withDefault([]),
};

export const loadListParams = createLoader(listParsers);

/** 목록은 한 번에 최대 이만큼 보여 준다(긴급도 → 최근 변경 순). 넘치면 필터로 좁히도록 안내한다. */
export const LIST_CAP = 100;
