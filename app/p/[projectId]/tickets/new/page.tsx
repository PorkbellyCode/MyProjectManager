import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getNewTicketContext } from "@/lib/tickets/detail";
import { PageFallback, PageFrame } from "@/components/app-shell/page-frame";
import { TicketForm } from "@/components/ticket/ticket-form";

export const metadata = { title: "새 티켓" };

export default function NewTicketPage({ params }: PageProps<"/p/[projectId]/tickets/new">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <NewTicket params={params} />
    </Suspense>
  );
}

async function NewTicket({ params }: { params: PageProps<"/p/[projectId]/tickets/new">["params"] }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const ctx = await getNewTicketContext(db, projectId, user.id);
  if (!ctx) notFound();
  return (
    <PageFrame title="새 티켓" description={
        ctx.project.aiAvailable
          ? `${ctx.project.name}에 요청을 보내요. 빠진 정보가 있으면 AI가 몇 가지만 물어볼게요.`
          : `${ctx.project.name}에 요청을 보내요.`
      }>
      <TicketForm projectId={ctx.project.id} aiAvailable={ctx.project.aiAvailable} targets={ctx.targets} />
    </PageFrame>
  );
}
