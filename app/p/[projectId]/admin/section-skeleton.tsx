/** 관리자 섹션을 불러오는 동안의 자리표시(loading.tsx와 각 섹션의 Suspense가 같이 쓴다). */
export function SectionSkeleton() {
  return (
    <div role="status" aria-label="불러오는 중" className="flex flex-col gap-4" data-testid="admin-loading">
      <div className="h-7 w-40 animate-pulse rounded-md bg-sunken" />
      <div className="h-4 w-full max-w-md animate-pulse rounded-md bg-sunken" />
      {[0, 1, 2].map((i) => (
        <div key={i} className="h-28 animate-pulse rounded-[14px] border border-line bg-surface" style={{ animationDelay: `${i * 120}ms` }} />
      ))}
      <span className="sr-only">불러오는 중이에요</span>
    </div>
  );
}
