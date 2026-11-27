import { Suspense } from "react";
import { db } from "@/lib/db";
import { getAdminGroups, getAdminMembers } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { SectionSkeleton } from "../section-skeleton";
import { GroupsSection } from "@/components/admin/groups-section";

export const metadata = { title: "그룹" };

export default function GroupsPage({ params }: PageProps<"/p/[projectId]/admin/groups">) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <GroupsPageBody params={params} />
    </Suspense>
  );
}

async function GroupsPageBody({ params }: { params: PageProps<"/p/[projectId]/admin/groups">["params"] }) {
  const { projectId } = await requireLeadPage(params);
  const [groups, members] = await Promise.all([getAdminGroups(db, projectId), getAdminMembers(db, projectId)]);
  return <GroupsSection projectId={projectId} groups={groups} members={members} />;
}
