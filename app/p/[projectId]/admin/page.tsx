import { Suspense } from "react";
import Link from "next/link";
import { forbidden, notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMembership } from "@/lib/access";
import { getAdminData } from "@/lib/projects/admin";
import { isUuid } from "@/lib/tickets/detail";
import { PageFallback, PageFrame } from "@/components/app-shell/page-frame";
import { AgentsPanel } from "@/components/admin/agents-panel";
import { DomainPanel } from "@/components/admin/domain-panel";
import { MembersSection } from "@/components/admin/members-section";
import { GroupsSection } from "@/components/admin/groups-section";
import { ProjectSettings } from "@/components/admin/project-settings";
import { cn } from "@/lib/utils";

export const metadata = { title: "관리자" };

const TABS = [
  { key: "domain", label: "도메인 지식" },
  { key: "agents", label: "에이전트" },
  { key: "settings", label: "설정" },
] as const;
type Tab = (typeof TABS)[number]["key"];

const NOT_DEMO_NOTICE = "AI 키 등록은 3차에 열려요. 지금은 시연 프로젝트에서만 AI가 동작해요.";

export default function AdminPage({ params, searchParams }: PageProps<"/p/[projectId]/admin">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Admin params={params} searchParams={searchParams} />
    </Suspense>
  );
}

// 비멤버는 404, 멤버지만 리드가 아니면 403("권한이 없어요").
async function Admin({
  params,
  searchParams,
}: {
  params: PageProps<"/p/[projectId]/admin">["params"];
  searchParams: PageProps<"/p/[projectId]/admin">["searchParams"];
}) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const membership = isUuid(projectId) ? await getMembership(db, projectId, user.id) : null;
  if (!membership) notFound();
  if (membership.role !== "lead") forbidden();

  const raw = (await searchParams).tab;
  const tab: Tab = TABS.find((t) => t.key === raw)?.key ?? "domain";
  const data = await getAdminData(db, projectId);
  if (!data) notFound();

  return (
    <PageFrame title="관리자" description="도메인 지식, 에이전트 지시사항, 프로젝트 설정을 관리해요.">
      <div className="flex flex-col gap-8">
        <nav aria-label="관리자 탭" className="flex gap-1 border-b border-line">
          {TABS.map((t) => (
            <Link
              key={t.key}
              href={`/p/${projectId}/admin?tab=${t.key}`}
              aria-current={t.key === tab ? "page" : undefined}
              className={cn(
                "-mb-px border-b-2 px-4 py-2.5 text-sm transition-colors",
                t.key === tab ? "border-brand font-semibold text-text" : "border-transparent text-muted-text hover:text-text",
              )}
            >
              {t.label}
            </Link>
          ))}
        </nav>
        <div className="max-w-4xl">
          {tab === "domain" && <DomainPanel projectId={projectId} docs={data.docs} />}
          {tab === "agents" && <AgentsPanel projectId={projectId} agents={data.agents} />}
          {tab === "settings" && (
            <div className="flex flex-col gap-10">
              {!data.project.isDemo && (
                <p role="note" className="rounded-[14px] border border-line bg-sunken px-5 py-3 text-sm">
                  {NOT_DEMO_NOTICE}
                </p>
              )}
              <MembersSection projectId={projectId} members={data.members} invitations={data.invitations} />
              <GroupsSection projectId={projectId} groups={data.groups} members={data.members} />
              <ProjectSettings projectId={projectId} project={data.project} />
            </div>
          )}
        </div>
      </div>
    </PageFrame>
  );
}
