import { Suspense } from "react";
import { AppShell, ShellSkeleton } from "@/components/app-shell/shell";

// cacheComponents: 세션·DB·params는 요청 시점 데이터이므로 Suspense 경계 안에서 읽는다.
export default function ProjectLayout({ children, params }: LayoutProps<"/p/[projectId]">) {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <ProjectShell params={params}>{children}</ProjectShell>
    </Suspense>
  );
}

async function ProjectShell({ params, children }: { params: LayoutProps<"/p/[projectId]">["params"]; children: React.ReactNode }) {
  const { projectId } = await params;
  return <AppShell projectId={projectId}>{children}</AppShell>;
}
