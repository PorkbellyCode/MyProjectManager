import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getProjectSummary } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { SectionSkeleton } from "../section-skeleton";
import { ProjectSettings } from "@/components/admin/project-settings";
import { SectionHeader } from "../section-header";

export const metadata = { title: "프로젝트 설정" };

const NOT_DEMO_NOTICE = "AI 키 등록은 3차에 열려요. 지금은 시연 프로젝트에서만 AI가 동작해요.";

export default function SettingsPage({ params }: PageProps<"/p/[projectId]/admin/settings">) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <SettingsPageBody params={params} />
    </Suspense>
  );
}

async function SettingsPageBody({ params }: { params: PageProps<"/p/[projectId]/admin/settings">["params"] }) {
  const { projectId } = await requireLeadPage(params);
  const project = await getProjectSummary(db, projectId);
  if (!project) notFound();
  return (
    <section aria-labelledby="sec-settings" className="flex flex-col">
      <SectionHeader id="sec-settings" title="프로젝트 설정" description="AI 제공자, 기본 강조색, GitHub 토큰을 정해요." />
      {!project.isDemo && (
        <p role="note" className="mb-6 rounded-[14px] border border-line bg-sunken px-5 py-3 text-sm">
          {NOT_DEMO_NOTICE}
        </p>
      )}
      <ProjectSettings projectId={projectId} project={project} />
    </section>
  );
}
