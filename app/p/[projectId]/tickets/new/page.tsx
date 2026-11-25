import { EmptyState, PageFrame } from "@/components/app-shell/page-frame";

export const metadata = { title: "새 티켓" };

export default function NewTicketPage() {
  return (
    <PageFrame title="새 티켓">
      <EmptyState title="작성 화면을 준비하고 있어요" body="곧 여기서 요청을 작성할 수 있어요." />
    </PageFrame>
  );
}
