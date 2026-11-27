import { Suspense } from "react";
import { db } from "@/lib/db";
import { getAdminInvitations, getAdminMembers } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { SectionSkeleton } from "../section-skeleton";
import { MembersSection } from "@/components/admin/members-section";

export const metadata = { title: "멤버·초대" };

export default function MembersPage({ params }: PageProps<"/p/[projectId]/admin/members">) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <MembersPageBody params={params} />
    </Suspense>
  );
}

async function MembersPageBody({ params }: { params: PageProps<"/p/[projectId]/admin/members">["params"] }) {
  const { projectId, userId } = await requireLeadPage(params);
  const [members, invitations] = await Promise.all([getAdminMembers(db, projectId), getAdminInvitations(db, projectId)]);
  return <MembersSection projectId={projectId} members={members} invitations={invitations} currentUserId={userId} />;
}
