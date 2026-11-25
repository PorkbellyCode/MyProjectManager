import { EmptyState, PageFrame } from "@/components/app-shell/page-frame";

export const metadata = { title: "레포" };

export default function RepoPage() {
  return (
    <PageFrame title="레포" description="연결된 레포를 분석한 결과를 보여줘요.">
      <EmptyState title="레포 화면을 준비하고 있어요" body="분석이 끝나면 구조와 흐름이 이곳에 나타나요." />
    </PageFrame>
  );
}
