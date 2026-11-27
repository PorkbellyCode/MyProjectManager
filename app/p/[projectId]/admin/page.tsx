import { Suspense } from "react";
import { redirect } from "next/navigation";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { SectionSkeleton } from "./section-skeleton";

// 예전 주소(?tab=domain|agents|settings)도 받아서 새 섹션 경로로 보낸다.
const LEGACY: Record<string, string> = { domain: "domain", agents: "agents", settings: "members" };

export default function AdminIndex({ params, searchParams }: PageProps<"/p/[projectId]/admin">) {
  return (
    <Suspense fallback={<SectionSkeleton />}>
      <Redirect params={params} searchParams={searchParams} />
    </Suspense>
  );
}

async function Redirect({ params, searchParams }: Pick<PageProps<"/p/[projectId]/admin">, "params" | "searchParams">): Promise<never> {
  const { projectId } = await requireLeadPage(params);
  const tab = (await searchParams).tab;
  redirect(`/p/${projectId}/admin/${LEGACY[typeof tab === "string" ? tab : ""] ?? "domain"}`);
}
