import { PageFrame } from "@/components/app-shell/page-frame";
import { AdminMenu } from "@/components/admin/admin-menu";

export const metadata = { title: { template: "%s · 관리자 · MyProjectManager", default: "관리자" } };

/**
 * 관리자 틀: 제목과 섹션 메뉴는 요청 시점 데이터 없이 바로 그린다. 섹션 내용(children)만 요청마다 불러오고,
 * 그동안은 loading.tsx가 자리를 잡는다. 리드 확인은 각 섹션 화면이 한다(requireLeadPage).
 */
export default function AdminLayout({ children }: LayoutProps<"/p/[projectId]/admin">) {
  return (
    <PageFrame title="관리자" description="도메인 지식, 에이전트 지시사항, 멤버와 그룹, 프로젝트 설정을 관리해요.">
      <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[200px_minmax(0,1fr)] lg:gap-12">
        <AdminMenu />
        <div className="min-w-0 max-w-4xl">{children}</div>
      </div>
    </PageFrame>
  );
}
