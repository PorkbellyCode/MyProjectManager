import type { Category, CloseReason, ReviewStage, TicketStatus, Urgency, WithdrawKind } from "@/lib/db/schema/tickets";

/** 화면에 쓰는 이름(상위 설계 6.6 상태 이름, 도식 2·3장). 서버·클라이언트 어디서나 import할 수 있다(DB 접근 없음). */
export const STATUS_LABEL: Record<TicketStatus, string> = {
  draft: "작성중",
  ai_reviewing: "AI 검토중",
  awaiting_requester: "요청자 확인 대기",
  withdrawn_ai_resolved: "철회(AI 해소)",
  queued: "큐 대기",
  assigned: "배정됨",
  in_progress: "진행중",
  on_hold: "보류",
  resolved: "확인 대기",
  closed: "종결",
};

/** 상태 점 색. 강조색과 겹치지 않도록 중립·의미색만 쓴다(디자인 규칙 3.2: 색 점 + 글자). */
export const STATUS_DOT: Record<TicketStatus, string> = {
  draft: "#A8A29E",
  ai_reviewing: "#A855F7",
  awaiting_requester: "#D97706",
  withdrawn_ai_resolved: "#A8A29E",
  queued: "#64748B",
  assigned: "#3B82F6",
  in_progress: "#2563EB",
  on_hold: "#CA8A04",
  resolved: "#0D9488",
  closed: "#16A34A",
};

export const CATEGORY_LABEL: Record<Category, string> = {
  defect: "결함",
  improvement: "개선사항",
  feature: "신규 기능",
  inquiry: "문의",
};
export const CATEGORIES = Object.keys(CATEGORY_LABEL) as Category[];

export const URGENCY_LABEL: Record<Urgency, string> = { low: "낮음", normal: "보통", high: "높음", urgent: "긴급" };
export const URGENCIES = Object.keys(URGENCY_LABEL) as Urgency[];
export const URGENCY_LEVEL: Record<Urgency, number> = { low: 1, normal: 2, high: 3, urgent: 4 };

/** 검토 단계 표시(인터뷰 설계 3절). 순서 = 화면 순서. */
export const REVIEW_STAGES: { stage: ReviewStage; label: string }[] = [
  { stage: "dedup", label: "중복 확인 중" },
  { stage: "resolve", label: "해소 확인 중" },
  { stage: "interview", label: "질문 준비 중" },
  { stage: "recommend", label: "대상 추천 중" },
];

export const STAGE_NAME: Record<ReviewStage, string> = {
  dedup: "중복 확인",
  resolve: "해소 확인",
  interview: "인터뷰",
  recommend: "대상 추천",
};

export const WITHDRAW_LABEL: Record<WithdrawKind, string> = {
  joined_duplicate: "중복 합류",
  already_resolved: "이미 해결됨",
  expected_behavior: "정상 동작",
};

export const CLOSE_REASON_LABEL: Record<CloseReason, string> = {
  resolved_confirmed: "해결 확인",
  wont_do: "안 하기로 함",
  duplicate: "중복",
  requester_withdrawn: "요청자 회수",
  other: "기타",
};

/** 티켓 번호 표기. */
export const ticketRef = (n: number | null | undefined) => (n == null ? "#?" : `#${n}`);
