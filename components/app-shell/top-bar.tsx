"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, ChevronsUpDown, Moon, Plus, Search, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberRole } from "@/lib/auth-roles";
import type { ThemePreference } from "@/lib/db/schema";
import { applyTheme, clearAccentVars, resolveTheme, useResolvedTheme } from "@/lib/theme/client";
import { CommandPalette, openPalette } from "./command-palette";
import { MobileNav } from "./mobile-nav";
import { Nav } from "./nav";
import { NotificationBadge } from "./notification-badge";
import { ProfileMenu, useSavePreferences, type ProjectAccent } from "./profile-menu";

type Props = {
  user: { name: string; email: string };
  projects: { id: string; name: string }[];
  current: { id: string; name: string; role: MemberRole } | null;
  unread: number;
  theme: ThemePreference;
  accentOverride: string | null;
  projectAccent: ProjectAccent;
};

function ThemeToggle({ pref }: { pref: ThemePreference }) {
  const resolved = useResolvedTheme();
  const save = useSavePreferences();
  const next = resolved === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      aria-label={resolved === "dark" ? "라이트 테마로 전환" : "다크 테마로 전환"}
      // 라이트↔다크만 오간다(제품 결정 2-4). '시스템'은 프로필 메뉴에서 고른다.
      title={`${resolved === "dark" ? "라이트" : "다크"} 테마로 전환 · 시스템 설정 따르기는 프로필 메뉴에서`}
      onClick={() => {
        applyTheme(next);
        save({ theme: next });
      }}
      data-pref={pref}
      className="flex size-10 items-center justify-center rounded-lg border border-line text-text pointer-coarse:size-11 transition-[transform,background-color] duration-[120ms] hover:-translate-y-px hover:bg-sunken"
    >
      {resolved === "dark" ? <Sun className="size-[18px]" aria-hidden="true" /> : <Moon className="size-[18px]" aria-hidden="true" />}
    </button>
  );
}

export function TopBar({ user, projects, current, unread, theme, accentOverride, projectAccent }: Props) {
  const router = useRouter();

  // 서버가 정한 설정과 html 상태를 맞춘다(다른 기기에서 바꾼 설정, 시스템 테마 변경 포함).
  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => document.documentElement.setAttribute("data-theme", resolveTheme("system"));
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // 서버가 새 강조색을 내려보내면(저장 후, 프로젝트 전환) 즉시 반영용 값을 걷어낸다.
  const accentKey = `${accentOverride ?? ""}|${projectAccent.light}`;
  useEffect(() => {
    clearAccentVars();
  }, [accentKey]);

  // 알림처럼 프로젝트 밖 화면이 어느 프로젝트의 메뉴·강조색을 쓸지 기억해 둔다.
  useEffect(() => {
    if (current) document.cookie = `mpm-project=${current.id}; path=/; max-age=31536000; samesite=lax`;
  }, [current]);

  return (
    <header className="sticky top-0 z-40 border-b border-line bg-surface">
      <div className="flex h-[calc(var(--header-h)-1px)] items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:gap-4 lg:px-8">
        <MobileNav current={current} projects={projects} extra={<ThemeRow pref={theme} />} />
        <div className="flex min-w-0 flex-1 items-center gap-2 md:flex-none">
          <Link href="/" className="hidden shrink-0 items-center gap-2.5 rounded-lg sm:flex" aria-label="MyProjectManager 홈">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-[7px] bg-brand font-mono text-[13px] font-semibold text-on-brand"
            >
              M
            </span>
            <span className="hidden text-[15px] font-semibold lg:inline">MyProjectManager</span>
          </Link>
          {current && (
            <>
              <span aria-hidden="true" className="hidden text-faint sm:inline">
                /
              </span>
              <ProjectSwitcher current={current} projects={projects} onPick={(id) => router.push(`/p/${id}/tickets`)} />
            </>
          )}
        </div>

        {current && (
          <div className="hidden md:flex">
            <Nav projectId={current.id} role={current.role} />
          </div>
        )}

        <div className="ml-auto flex min-w-0 items-center justify-end gap-2 md:ml-0 md:flex-1 md:justify-center">
          <button
            type="button"
            onClick={openPalette}
            aria-label="이동하거나 검색하기"
            aria-keyshortcuts="Control+K Meta+K"
            title="이동하거나 검색하기 (Ctrl K)"
            className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-line text-text pointer-coarse:h-11 max-md:pointer-coarse:w-11 transition-[transform,background-color] duration-[120ms] hover:-translate-y-px hover:bg-sunken md:h-10 md:w-full md:max-w-[440px] md:justify-start md:gap-2.5 md:bg-sunken md:px-3.5 md:text-left md:text-sm md:text-faint"
          >
            <Search className="size-[18px] shrink-0 md:size-4" aria-hidden="true" />
            <span aria-hidden="true" className="hidden min-w-0 flex-1 truncate md:block">
              이동하거나 검색하기
            </span>
            <kbd aria-hidden="true" className="hidden shrink-0 whitespace-nowrap rounded border border-line px-1.5 font-mono text-xs lg:inline pointer-coarse:hidden">
              Ctrl K
            </kbd>
          </button>
        </div>

        <div className="flex shrink-0 items-center gap-2">
          <NotificationBadge initial={unread} />
          <div className="hidden sm:block">
            <ThemeToggle pref={theme} />
          </div>
          <ProfileMenu user={user} theme={theme} accentOverride={accentOverride} projectAccent={projectAccent} />
        </div>
      </div>
      <CommandPalette current={current ? { id: current.id, role: current.role } : null} projects={projects} />
    </header>
  );
}

/** 브레드크럼의 프로젝트 이름 = 프로젝트 전환 메뉴. 프로젝트가 하나여도 열려서 '새 프로젝트'로 갈 수 있다. */
function ProjectSwitcher({
  current,
  projects,
  onPick,
}: {
  current: { id: string; name: string };
  projects: { id: string; name: string }[];
  onPick: (id: string) => void;
}) {
  const router = useRouter();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          type="button"
          aria-label={`프로젝트 전환: 지금 ${current.name}`}
          title={current.name}
          className="inline-flex min-w-0 max-w-full items-center gap-1 rounded-lg px-2 py-1.5 text-[15px] transition-colors hover:bg-sunken sm:max-w-[220px] pointer-coarse:min-h-11"
        >
          <span className="truncate">{current.name}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-faint" aria-hidden="true" />
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="min-w-56 max-w-[min(320px,90vw)]">
        <DropdownMenuLabel className="text-xs font-medium text-faint">내 프로젝트</DropdownMenuLabel>
        {projects.map((p) => (
          <DropdownMenuItem key={p.id} onSelect={() => onPick(p.id)} aria-current={p.id === current.id ? "true" : undefined}>
            <span className="min-w-0 flex-1 truncate">{p.name}</span>
            {p.id === current.id && <Check className="text-brand" aria-hidden="true" />}
          </DropdownMenuItem>
        ))}
        <DropdownMenuSeparator />
        <DropdownMenuItem onSelect={() => router.push("/projects/new")}>
          <Plus aria-hidden="true" />새 프로젝트
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** 서랍 아래쪽의 테마 전환(sm 미만에서는 상단 바에 토글이 없다). */
function ThemeRow({ pref }: { pref: ThemePreference }) {
  const resolved = useResolvedTheme();
  return (
    <div className="flex items-center justify-between gap-3 px-2">
      <span className="text-sm text-muted-text">{resolved === "dark" ? "다크 테마" : "라이트 테마"}</span>
      <ThemeToggle pref={pref} />
    </div>
  );
}
