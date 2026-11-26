import { Suspense } from "react";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PageFallback, PageFrame } from "@/components/app-shell/page-frame";
import { TicketTable } from "@/components/ticket/ticket-table";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { ForbiddenError } from "@/lib/access";
import { listTickets } from "@/lib/tickets/list";
import { loadListParams } from "@/lib/tickets/views";

export const metadata = { title: "티켓" };

export default function TicketsPage({ params, searchParams }: PageProps<"/p/[projectId]/tickets">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Tickets params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Tickets({
  params,
  searchParams,
}: {
  params: PageProps<"/p/[projectId]/tickets">["params"];
  searchParams: PageProps<"/p/[projectId]/tickets">["searchParams"];
}) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const { view, urgency, status } = await loadListParams(searchParams);
  const data = await listTickets(db, { projectId, userId: user.id, view, urgency, status }).catch((e) => {
    if (e instanceof ForbiddenError) notFound();
    throw e;
  });

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
      <TicketTable
        projectId={projectId}
        provider={data.provider}
        view={data.view}
        views={data.views}
        counts={data.counts}
        rows={data.rows}
        total={data.total}
      />
    </PageFrame>
  );
}
