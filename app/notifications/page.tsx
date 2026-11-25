import { EmptyState, PageFrame } from "@/components/app-shell/page-frame";

export const metadata = { title: "알림" };

export default function NotificationsPage() {
  return (
    <PageFrame title="알림" description="내가 요청했거나 맡은 티켓의 변화를 모아 보여줘요.">
      <EmptyState title="알림 목록을 준비하고 있어요" body="새 알림은 상단 바의 종 아이콘에도 표시돼요." />
    </PageFrame>
  );
}
