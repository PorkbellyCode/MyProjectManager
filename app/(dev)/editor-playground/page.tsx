import { Suspense } from "react";
import { notFound } from "next/navigation";
import { env } from "@/lib/env";
import { Playground } from "./playground";

// E2E 전용 화면. MPM_FAKE_BLOB=1 이 아니면 404. 실제 화면에 편집기가 붙기 전까지 붙여넣기/드롭 흐름을 검증하는 데 쓴다.
export default function EditorPlaygroundPage({ searchParams }: PageProps<"/editor-playground">) {
  if (env.MPM_FAKE_BLOB !== "1") notFound();
  return (
    <Suspense>
      <Content searchParams={searchParams} />
    </Suspense>
  );
}

async function Content({ searchParams }: { searchParams: PageProps<"/editor-playground">["searchParams"] }) {
  const { project } = await searchParams;
  const projectId = typeof project === "string" ? project : "";
  return <Playground projectId={projectId} />;
}
