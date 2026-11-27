"use client";

import { useEffect, useRef } from "react";
import Link, { useLinkStatus } from "next/link";
import { useParams, usePathname } from "next/navigation";
import { Bot, BookOpenText, Loader2, Settings2, Users, UsersRound } from "lucide-react";
import { cn } from "@/lib/utils";

export const ADMIN_SECTIONS = [
  { key: "domain", label: "도메인 지식", icon: BookOpenText },
  { key: "agents", label: "에이전트", icon: Bot },
  { key: "members", label: "멤버·초대", icon: Users },
  { key: "groups", label: "그룹", icon: UsersRound },
  { key: "settings", label: "프로젝트 설정", icon: Settings2 },
] as const;
export type AdminSection = (typeof ADMIN_SECTIONS)[number]["key"];

/** 누른 메뉴 옆에 도는 표시. 자리는 늘 잡아 두고 보이기만 바꾼다(레이아웃 흔들림 방지). */
function PendingMark() {
  const { pending } = useLinkStatus();
  return (
    <>
      <Loader2
        aria-hidden="true"
        className={cn("ml-auto size-3.5 shrink-0 animate-spin text-faint transition-opacity duration-150", pending ? "opacity-100" : "opacity-0")}
      />
      {pending && <span className="sr-only">불러오는 중</span>}
    </>
  );
}

/**
 * 관리자 섹션 메뉴. 넓은 화면은 왼쪽 세로 메뉴, 좁은 화면은 가로로 밀어 보는 메뉴.
 * 섹션은 각자 하위 경로라서 그 섹션 데이터만 불러오고, 그동안 loading.tsx 자리표시와 메뉴 옆 표시가 보인다.
 */
export function AdminMenu() {
  const { projectId } = useParams<{ projectId: string }>();
  const pathname = usePathname();
  const base = `/p/${projectId}/admin`;
  const listRef = useRef<HTMLUListElement>(null);
  // 좁은 화면(가로 메뉴)에서 지금 섹션이 화면 밖에 있으면 보이게 민다.
  useEffect(() => {
    const list = listRef.current;
    const el = list?.querySelector<HTMLElement>('[aria-current="page"]');
    if (!list || !el || list.scrollWidth <= list.clientWidth) return;
    list.scrollTo({ left: el.offsetLeft - 24, behavior: "smooth" });
  }, [pathname]);
  return (
    <nav aria-label="관리자 메뉴" className="-mx-6 min-w-0 sm:-mx-12 lg:sticky lg:top-[calc(var(--header-h)+24px)] lg:mx-0 lg:self-start">
      <ul ref={listRef} className="relative flex snap-x gap-1 overflow-x-auto px-6 pb-1 [scrollbar-width:none] sm:px-12 lg:flex-col lg:overflow-visible lg:px-0 lg:pb-0">
        {ADMIN_SECTIONS.map((s) => {
          const href = `${base}/${s.key}`;
          const active = pathname === href || pathname.startsWith(`${href}/`);
          const Icon = s.icon;
          return (
            <li key={s.key} className="shrink-0 snap-start">
              <Link
                href={href}
                aria-current={active ? "page" : undefined}
                className={cn(
                  "flex min-h-10 items-center gap-2.5 whitespace-nowrap rounded-lg border px-3 py-2 text-sm transition-colors duration-[120ms] pointer-coarse:min-h-11 lg:w-full",
                  active
                    ? "border-line bg-surface font-semibold text-text lg:border-transparent lg:bg-brand-sel"
                    : "border-transparent text-muted-text hover:bg-sunken hover:text-text",
                )}
              >
                <Icon aria-hidden="true" className={cn("size-4 shrink-0", active ? "text-brand" : "text-faint")} />
                {s.label}
                <PendingMark />
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
