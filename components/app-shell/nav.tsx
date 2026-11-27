"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import type { MemberRole } from "@/lib/auth-roles";

export type NavItem = { href: string; label: string; match: string };

/** 프로젝트 메뉴. 관리자는 리드에게만 보인다. */
export function navItems(projectId: string, role: MemberRole): NavItem[] {
  const base = `/p/${projectId}`;
  const items: NavItem[] = [
    { href: `${base}/tickets`, label: "티켓", match: `${base}/tickets` },
    { href: `${base}/repo`, label: "레포", match: `${base}/repo` },
  ];
  if (role === "lead") items.push({ href: `${base}/admin`, label: "관리자", match: `${base}/admin` });
  return items;
}

export function Nav({ projectId, role }: { projectId: string; role: MemberRole }) {
  const pathname = usePathname();
  return (
    <nav aria-label="프로젝트 메뉴" className="flex items-center gap-1">
      {navItems(projectId, role).map((item) => {
        const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? "page" : undefined}
            className={cn(
              "relative flex h-9 items-center whitespace-nowrap rounded-lg px-3 text-sm transition-colors duration-[120ms]",
              active ? "font-semibold text-text" : "text-muted-text hover:bg-sunken hover:text-text",
            )}
          >
            {item.label}
            {/* 선택 표시: 강조색 밑줄 */}
            <span
              aria-hidden="true"
              className={cn(
                "absolute inset-x-3 -bottom-3 h-0.5 rounded-full bg-brand transition-opacity duration-[120ms]",
                active ? "opacity-100" : "opacity-0",
              )}
            />
          </Link>
        );
      })}
    </nav>
  );
}
