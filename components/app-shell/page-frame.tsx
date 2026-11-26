import { fadeUpDelay } from "@/lib/motion";

/** 아직 내용이 붙지 않은 화면의 공통 틀. 제목 30px, 안쪽 여백 40~48px. */
export function PageFrame({
  title,
  description,
  actions,
  children,
}: {
  title: string;
  description?: string;
  actions?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <div className="mx-auto w-full max-w-[1440px] px-6 py-10 sm:px-12">
      <div className="rise flex flex-wrap items-start justify-between gap-4">
        <div className="flex flex-col gap-3">
          <h1 className="text-[30px] font-semibold leading-[1.35] tracking-[-0.01em]">{title}</h1>
          {description && <p className="max-w-prose text-base leading-[1.75] text-muted-text">{description}</p>}
        </div>
        {actions}
      </div>
      {children && (
        <div className="rise mt-8" style={fadeUpDelay(1)}>
          {children}
        </div>
      )}
    </div>
  );
}

export function EmptyState({ title, body }: { title: string; body: string }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line bg-surface px-6 py-16 text-center">
      <p className="text-[15px] font-medium">{title}</p>
      <p className="max-w-sm text-sm text-muted-text">{body}</p>
    </div>
  );
}

/** 페이지가 요청 시점 데이터를 기다리는 동안 보이는 자리표시. */
export function PageFallback() {
  return <div className="mx-auto w-full max-w-[1440px] px-6 py-10 sm:px-12" aria-busy="true" />;
}
