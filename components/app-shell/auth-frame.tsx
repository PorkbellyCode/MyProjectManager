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
