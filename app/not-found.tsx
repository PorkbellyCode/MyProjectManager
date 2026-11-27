import { Suspense } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { getSessionUser } from "@/lib/auth";
import { AppShell, ShellSkeleton } from "@/components/app-shell/shell";
import { AuthFrame } from "@/components/app-shell/auth-frame";

export const metadata = { title: "페이지를 찾을 수 없어요" };

/** 없는 주소, 볼 수 없는 프로젝트·티켓. 로그인했으면 앱 상단 바와 함께, 아니면 로그인 화면 틀로 보인다. */
export default function NotFound() {
  return (
    <Suspense fallback={<ShellSkeleton />}>
      <NotFoundBody />
    </Suspense>
  );
}

function Message() {
  return (
    <div className="flex flex-col items-start gap-5">
      <p className="font-mono text-sm text-faint">404</p>
      <div className="flex flex-col gap-2">
        <h1 className="text-[30px] font-semibold leading-[1.35] tracking-[-0.01em]">페이지를 찾을 수 없어요</h1>
        <p className="max-w-prose text-base leading-[1.75] text-muted-text">
          주소가 바뀌었거나, 지워졌거나, 이 프로젝트의 멤버만 볼 수 있는 화면이에요. 주소를 다시 확인해 주세요.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex h-10 items-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-[transform] duration-[120ms] hover:-translate-y-px pointer-coarse:h-11"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        내 프로젝트로 돌아가기
      </Link>
    </div>
  );
}

async function NotFoundBody() {
  const user = await getSessionUser();
  if (!user) {
    return (
      <AuthFrame title="페이지를 찾을 수 없어요" description="주소를 다시 확인해 주세요.">
        <Link href="/login" className="text-sm underline underline-offset-4">
          로그인 화면으로
        </Link>
      </AuthFrame>
    );
  }
  return (
    <AppShell>
      <div className="mx-auto flex w-full max-w-[1440px] flex-1 items-center px-6 py-16 sm:px-12">
        <div className="rise">
          <Message />
        </div>
      </div>
    </AppShell>
  );
}
