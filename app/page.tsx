import { Suspense } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserProjects } from "@/lib/projects/queries";
import { AppShell, LAST_PROJECT_COOKIE, ShellSkeleton } from "@/components/app-shell/shell";
import { EmptyState, PageFrame } from "@/components/app-shell/page-frame";

// 비로그인 → /login, 로그인 → 내 프로젝트의 티켓 목록. 프로젝트가 하나도 없으면 안내 화면.
export default function Home() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <Entry />
    </Suspense>
  );
}

async function Entry() {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const projects = await listUserProjects(db, user.id);
  const last = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
  const target = projects.find((p) => p.id === last) ?? projects[0];
  if (target) redirect(`/p/${target.id}/tickets`);
  return (
    <AppShell>
      <PageFrame title="참여 중인 프로젝트가 없어요">
        <EmptyState title="초대를 기다리고 있어요" body="프로젝트 리드에게 초대 링크를 받으면 이곳에서 바로 시작할 수 있어요." />
      </PageFrame>
    </AppShell>
  );
}
