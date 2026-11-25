import { Suspense } from "react";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { invitation, projects } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { InviteAccept } from "./invite-accept";

const EXPIRED = "초대가 만료됐어요. 관리자에게 다시 요청해 주세요.";

function isExpired(expiresAt: Date) {
  return expiresAt.getTime() <= Date.now();
}

// cacheComponents: params/DB/세션은 요청 시점 데이터이므로 Suspense 경계 안에서 읽는다.
export default function InvitePage({ params }: { params: Promise<{ invitationId: string }> }) {
  return (
    <Suspense fallback={<main aria-busy="true" />}>
      <InviteContent params={params} />
    </Suspense>
  );
}

async function InviteContent({ params }: { params: Promise<{ invitationId: string }> }) {
  const { invitationId } = await params;
  const [inv] = await db.select().from(invitation).where(eq(invitation.id, invitationId)).limit(1);

  if (!inv || inv.status !== "pending" || isExpired(inv.expiresAt)) {
    return (
      <main>
        <p role="alert">{EXPIRED}</p>
      </main>
    );
  }

  const [project] = await db.select().from(projects).where(eq(projects.organizationId, inv.organizationId)).limit(1);
  const user = await getSessionUser();

  if (user && user.email.toLowerCase() !== inv.email.toLowerCase()) {
    return (
      <main>
        <p role="alert">이 초대는 {inv.email} 계정으로만 수락할 수 있어요. 해당 계정으로 로그인해 주세요.</p>
      </main>
    );
  }

  return (
    <InviteAccept
      invitationId={inv.id}
      email={inv.email}
      projectName={project?.name ?? ""}
      projectId={project?.id ?? null}
      loggedIn={!!user}
    />
  );
}
