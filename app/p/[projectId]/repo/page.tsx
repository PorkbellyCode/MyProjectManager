import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMembership } from "@/lib/access";
import { getRepoPageData } from "@/lib/projects/admin";
import { isUuid } from "@/lib/tickets/detail";
import { PageFallback, PageFrame } from "@/components/app-shell/page-frame";
import { RepoOverview } from "@/components/repo/repo-overview";
import { ReanalyzeButton } from "@/components/repo/reanalyze-button";

export const metadata = { title: "레포" };

export default function RepoPage({ params }: PageProps<"/p/[projectId]/repo">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Repo params={params} />
    </Suspense>
  );
}

// 모든 멤버가 볼 수 있다. 태그 수정과 다시 분석은 리드만.
async function Repo({ params }: { params: PageProps<"/p/[projectId]/repo">["params"] }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const membership = isUuid(projectId) ? await getMembership(db, projectId, user.id) : null;
  if (!membership) notFound();
  const data = await getRepoPageData(db, projectId);
  if (!data) notFound();
  const canEdit = membership.role === "lead";
  return (
    <PageFrame
      title="레포"
      description={`${data.project.repoUrl.replace("https://github.com/", "")} 를 분석한 결과예요.`}
      actions={canEdit ? <ReanalyzeButton projectId={projectId} disabled={data.analyzing} /> : undefined}
    >
      <RepoOverview projectId={projectId} data={data} canEdit={canEdit} />
    </PageFrame>
  );
}
