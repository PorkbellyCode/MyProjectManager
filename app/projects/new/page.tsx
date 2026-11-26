import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AppShell, ShellSkeleton } from "@/components/app-shell/shell";
import { PageFrame } from "@/components/app-shell/page-frame";
import { NewProjectForm } from "@/components/admin/new-project-form";

export const metadata = { title: "새 프로젝트" };

export default function NewProjectPage() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <NewProject />
    </Suspense>
  );
}

async function NewProject() {
  if (!(await getSessionUser())) redirect("/login");
  return (
    <AppShell>
      <PageFrame title="새 프로젝트" description="레포를 연결하면 구조를 분석해서 개요를 보여줘요. 만든 사람이 리드가 돼요.">
        <NewProjectForm />
      </PageFrame>
    </AppShell>
  );
}
