"use client";

import { useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ChevronDown, Moon, Search, Sun } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { MemberRole } from "@/lib/auth-roles";
import type { ThemePreference } from "@/lib/db/schema";
import { applyTheme, clearAccentVars, resolveTheme, useResolvedTheme } from "@/lib/theme/client";
import { CommandPalette, openPalette } from "./command-palette";
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
      onClick={() => {
        applyTheme(next);
        save({ theme: next });
      }}
      data-pref={pref}
      className="flex size-10 items-center justify-center rounded-lg border border-line text-text transition-[transform,background-color] duration-[120ms] hover:-translate-y-px hover:bg-sunken"
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
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-8">
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5" aria-label="MyProjectManager 홈">
            <span
              aria-hidden="true"
              className="flex size-7 items-center justify-center rounded-[7px] bg-brand font-mono text-[13px] font-semibold text-on-brand"
            >
              M
            </span>
            <span className="hidden text-[15px] font-semibold sm:inline">MyProjectManager</span>
          </Link>
          {current && (
            <>
              <span aria-hidden="true" className="text-faint">
                /
              </span>
              {projects.length > 1 ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button
                      type="button"
                      aria-label={`프로젝트: ${current.name}`}
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[15px] transition-colors hover:bg-sunken"
                    >
                      {current.name}
                      <ChevronDown className="size-4 text-faint" aria-hidden="true" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="min-w-48">
                    {projects.map((p) => (
                      <DropdownMenuItem key={p.id} onSelect={() => router.push(`/p/${p.id}/tickets`)}>
                        {p.name}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <span className="text-[15px]">{current.name}</span>
              )}
            </>
          )}
        </div>

        {current && <Nav projectId={current.id} role={current.role} />}

        <div className="order-last flex min-w-0 basis-full justify-center sm:order-none sm:basis-0 sm:flex-1">
          <button
            type="button"
            onClick={openPalette}
            className="flex w-full max-w-[440px] items-center gap-2.5 rounded-lg border border-line bg-sunken px-3.5 py-2 text-left text-sm text-faint transition-[transform] duration-[120ms] hover:-translate-y-px"
          >
            <Search className="size-4 shrink-0" aria-hidden="true" />
            <span className="flex-1 truncate">이동하거나 검색하기</span>
            <kbd className="rounded border border-line px-1.5 font-mono text-xs">Ctrl K</kbd>
          </button>
        </div>

        <div className="ml-auto flex items-center gap-2 sm:ml-0">
          <NotificationBadge initial={unread} />
          <ThemeToggle pref={theme} />
          <ProfileMenu key={`${theme}:${accentOverride ?? ""}`} user={user} theme={theme} accentOverride={accentOverride} projectAccent={projectAccent} />
        </div>
      </div>
      <CommandPalette current={current ? { id: current.id, role: current.role } : null} projects={projects} />
    </header>
  );
}
