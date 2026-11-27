import { Suspense } from "react";
import { db } from "@/lib/db";
import { getAdminAgents } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { SectionSkeleton } from "../section-skeleton";
import { AgentsPanel } from "@/components/admin/agents-panel";
import { SectionHeader } from "../section-header";

export const metadata = { title: "에이전트" };

export default function AgentsSection({ params }: PageProps<"/p/[projectId]/admin/agents">) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <AgentsSectionBody params={params} />
    </Suspense>
  );
}

async function AgentsSectionBody({ params }: { params: PageProps<"/p/[projectId]/admin/agents">["params"] }) {
  const { projectId } = await requireLeadPage(params);
  const agents = await getAdminAgents(db, projectId);
  return (
    <section aria-labelledby="sec-agents">
      <SectionHeader id="sec-agents" title="에이전트" description="에이전트마다 지시사항을 고치면 새 버전으로 저장되고, 이전 버전은 목록에 남아요." />
      <AgentsPanel projectId={projectId} agents={agents} />
    </section>
  );
}
