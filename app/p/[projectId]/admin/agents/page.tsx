import { db } from "@/lib/db";
import { getAdminAgents } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { AgentsPanel } from "@/components/admin/agents-panel";
import { SectionHeader } from "../section-header";

export const metadata = { title: "에이전트" };

export default async function AgentsSection({ params }: PageProps<"/p/[projectId]/admin/agents">) {
  const { projectId } = await requireLeadPage(params);
  const agents = await getAdminAgents(db, projectId);
  return (
    <section aria-labelledby="sec-agents">
      <SectionHeader id="sec-agents" title="에이전트" description="에이전트마다 지시사항을 고치면 새 버전으로 저장되고, 이전 버전은 목록에 남아요." />
      <AgentsPanel projectId={projectId} agents={agents} />
    </section>
  );
}
