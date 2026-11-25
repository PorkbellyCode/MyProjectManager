import { Suspense } from "react";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMembership } from "@/lib/access";
import { EmptyState, PageFallback, PageFrame } from "@/components/app-shell/page-frame";

export const metadata = { title: "관리자" };

export default function AdminPage({ params }: PageProps<"/p/[projectId]/admin">) {
  return (
    <Suspense fallback={<PageFallback />}>
      <Admin params={params} />
    </Suspense>
  );
}

// 리드만 들어올 수 있다. 다른 역할은 메뉴에도 보이지 않고, 주소로 직접 열면 404.
async function Admin({ params }: { params: PageProps<"/p/[projectId]/admin">["params"] }) {
  const { projectId } = await params;
  const user = await getSessionUser();
  const membership = user ? await getMembership(db, projectId, user.id) : null;
  if (membership?.role !== "lead") notFound();
  return (
    <PageFrame title="관리자" description="그룹, 에이전트 지시사항, 도메인 지식을 관리해요.">
      <EmptyState title="관리 화면을 준비하고 있어요" body="그룹과 지시사항 편집이 이곳에 들어와요." />
    </PageFrame>
  );
}
