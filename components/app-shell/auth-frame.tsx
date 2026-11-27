import { fadeUpDelay } from "@/lib/motion";

/** 로그인·초대 화면의 공통 틀. 강조색은 기본 제공자(Claude) 색을 따른다. */
export function AuthFrame({ title, description, children }: { title: string; description?: string; children: React.ReactNode }) {
  return (
    <main className="flex flex-1 items-center justify-center px-4 py-16">
      <div className="rise flex w-full max-w-[400px] flex-col gap-8" style={fadeUpDelay(0)}>
        <div className="flex items-center gap-2.5">
          <span
            aria-hidden="true"
            className="flex size-7 items-center justify-center rounded-[7px] bg-brand font-mono text-[13px] font-semibold text-on-brand"
          >
            M
          </span>
          <span className="text-[15px] font-semibold">MyProjectManager</span>
        </div>
        <div className="flex flex-col gap-3">
          <h1 className="text-[30px] font-semibold leading-[1.35] tracking-[-0.01em]">{title}</h1>
          {description && <p className="text-base leading-[1.75] text-muted-text">{description}</p>}
        </div>
        <div className="rounded-[14px] border border-line bg-surface p-6">{children}</div>
      </div>
    </main>
  );
}

/** 로그인 확인 중 자리표시: 같은 틀에 입력란 자리만 잡아 둔다(레이아웃이 흔들리지 않게). */
export function AuthFrameSkeleton({ title, description }: { title: string; description?: string }) {
  return (
    <AuthFrame title={title} description={description}>
      <div aria-busy="true" className="flex flex-col gap-5">
        {[0, 1].map((i) => (
          <div key={i} className="flex flex-col gap-2">
            <div className="h-4 w-16 animate-pulse rounded bg-sunken" />
            <div className="h-10 animate-pulse rounded-lg bg-sunken" />
          </div>
        ))}
        <div className="h-10 animate-pulse rounded-lg bg-sunken" />
        <span className="sr-only">불러오는 중이에요</span>
      </div>
    </AuthFrame>
  );
}
