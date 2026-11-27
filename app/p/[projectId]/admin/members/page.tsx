import { db } from "@/lib/db";
import { getAdminInvitations, getAdminMembers } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { MembersSection } from "@/components/admin/members-section";

export const metadata = { title: "멤버·초대" };

export default async function MembersPage({ params }: PageProps<"/p/[projectId]/admin/members">) {
  const { projectId, userId } = await requireLeadPage(params);
  const [members, invitations] = await Promise.all([getAdminMembers(db, projectId), getAdminInvitations(db, projectId)]);
  return <MembersSection projectId={projectId} members={members} invitations={invitations} currentUserId={userId} />;
}
