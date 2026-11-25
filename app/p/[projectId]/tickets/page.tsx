import { Suspense } from "react";
import Link from "next/link";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { EmptyState, PageFallback, PageFrame } from "@/components/app-shell/page-frame";

export const metadata = { title: "티켓" };

export default function TicketsPage({ params }: PageProps<"/p/[projectId]/tickets">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Tickets params={params} />
    </Suspense>
  );
}

async function Tickets({ params }: { params: PageProps<"/p/[projectId]/tickets">["params"] }) {
  const { projectId } = await params;
  return (
    <PageFrame
      title="티켓"
      actions={
        <Button asChild>
          <Link href={`/p/${projectId}/tickets/new`}>
            <Plus aria-hidden="true" />새 티켓
          </Link>
        </Button>
      }
    >
      <EmptyState title="티켓 목록을 준비하고 있어요" body="요청이 접수되면 이곳에 모여요." />
    </PageFrame>
  );
}
