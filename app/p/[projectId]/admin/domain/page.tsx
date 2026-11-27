import { db } from "@/lib/db";
import { getAdminDocs } from "@/lib/projects/admin";
import { requireLeadPage } from "@/lib/projects/admin-page";
import { DomainPanel } from "@/components/admin/domain-panel";
import { SectionHeader } from "../section-header";

export const metadata = { title: "도메인 지식" };

export default async function DomainSection({ params }: PageProps<"/p/[projectId]/admin/domain">) {
  const { projectId } = await requireLeadPage(params);
  const docs = await getAdminDocs(db, projectId);
  return (
    <section aria-labelledby="sec-domain">
      <SectionHeader
        id="sec-domain"
        title="도메인 지식"
        description="AI가 요청을 검토할 때 참고하는 업무 용어와 정상 동작 기준이에요. 항목마다 제목을 붙여 적어 주세요."
      />
      <DomainPanel projectId={projectId} docs={docs} />
    </section>
  );
}
