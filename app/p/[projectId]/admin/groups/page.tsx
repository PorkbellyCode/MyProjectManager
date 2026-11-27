import { db } from "@/lib/db";
import { getAdminGroups, getAdminMembers } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { GroupsSection } from "@/components/admin/groups-section";

export const metadata = { title: "그룹" };

export default async function GroupsPage({ params }: PageProps<"/p/[projectId]/admin/groups">) {
  const { projectId } = await requireLeadPage(params);
  const [groups, members] = await Promise.all([getAdminGroups(db, projectId), getAdminMembers(db, projectId)]);
  return <GroupsSection projectId={projectId} groups={groups} members={members} />;
}
