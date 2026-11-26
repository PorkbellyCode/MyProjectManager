/** 알림 종류(이벤트 type) → 화면 문구. DB 접근 없음, 서버·클라이언트 공용. */
export const NOTIFICATION_LABEL: Record<string, string> = {
  stageReady: "AI 검토 결과가 준비됐어요",
  stageFailed: "AI 검토가 실패했어요",
  submit: "새 티켓이 들어왔어요",
  assignTarget: "티켓이 배정됐어요",
  transfer: "티켓이 이관됐어요",
  accept: "담당자가 수락했어요",
  claim: "담당자가 가져갔어요",
  hold: "보류됐어요",
  resume: "다시 진행해요",
  resolve: "처리가 끝났어요. 확인해 주세요",
  reopen: "요청자가 아직이에요라고 했어요",
  close: "종결됐어요",
  commented: "새 댓글이 있어요",
  summary_edited: "정리본이 고쳐졌어요",
  wont_do_proposed: "안 하기로 함 제안이 왔어요",
};

export const notificationLabel = (kind: string) => NOTIFICATION_LABEL[kind] ?? "티켓이 바뀌었어요";

/** 배지에 지금 바로 다시 세라고 알리는 이벤트(읽음 처리 뒤). */
export const NOTIFICATIONS_CHANGED = "mpm:notifications-changed";
