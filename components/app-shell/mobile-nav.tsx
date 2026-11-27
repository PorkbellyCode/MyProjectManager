"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Bell, Check, FolderGit2, Menu, Plus, Settings, Ticket, X } from "lucide-react";
import type { MemberRole } from "@/lib/auth-roles";
import { cn } from "@/lib/utils";
import { navItems } from "./nav";

const ICONS: Record<string, React.ReactNode> = {
  티켓: <Ticket className="size-[18px]" aria-hidden="true" />,
  레포: <FolderGit2 className="size-[18px]" aria-hidden="true" />,
  관리자: <Settings className="size-[18px]" aria-hidden="true" />,
};

const itemClass =
  "flex min-h-11 items-center gap-3 rounded-lg px-3 text-[15px] transition-colors duration-[120ms] hover:bg-sunken focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40";

/**
 * md 미만에서 프로젝트 메뉴를 대신하는 서랍. 왼쪽에서 열리고, 고르면 닫힌다.
 * 프로젝트 메뉴, 알림, 프로젝트 전환과 새 프로젝트가 들어 있다.
 */
export function MobileNav({
  current,
  projects,
  extra,
}: {
  current: { id: string; name: string; role: MemberRole } | null;
  projects: { id: string; name: string }[];
  extra?: React.ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const close = () => setOpen(false);
  const items = current ? navItems(current.id, current.role) : [];

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Trigger asChild>
        <button
          type="button"
          aria-label="메뉴 열기"
          className="-ml-1.5 flex size-10 shrink-0 items-center justify-center rounded-lg text-text transition-colors hover:bg-sunken md:hidden"
        >
          <Menu className="size-5" aria-hidden="true" />
        </button>
      </DialogPrimitive.Trigger>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/40 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content
          className="fixed inset-y-0 left-0 z-50 flex w-[min(320px,86vw)] flex-col border-r border-line bg-surface text-text outline-none duration-200 data-[state=closed]:animate-out data-[state=closed]:slide-out-to-left data-[state=open]:animate-in data-[state=open]:slide-in-from-left"
        >
          <div className="flex h-[var(--header-h)] shrink-0 items-center justify-between border-b border-line px-4">
            <DialogPrimitive.Title className="flex items-center gap-2.5 text-[15px] font-semibold">
              <span
                aria-hidden="true"
                className="flex size-7 items-center justify-center rounded-[7px] bg-brand font-mono text-[13px] font-semibold text-on-brand"
              >
                M
              </span>
              MyProjectManager
            </DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">프로젝트 메뉴와 프로젝트 전환</DialogPrimitive.Description>
            <DialogPrimitive.Close
              aria-label="메뉴 닫기"
              className="flex size-10 items-center justify-center rounded-lg text-muted-text transition-colors hover:bg-sunken hover:text-text"
            >
              <X className="size-5" aria-hidden="true" />
            </DialogPrimitive.Close>
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-3">
            {current && (
              <nav aria-label="프로젝트 메뉴 (모바일)" className="flex flex-col gap-0.5">
                {items.map((item) => {
                  const active = pathname === item.match || pathname.startsWith(`${item.match}/`);
                  return (
                    <Link
                      key={item.href}
                      href={item.href}
                      onClick={close}
                      aria-current={active ? "page" : undefined}
                      className={cn(itemClass, active ? "bg-brand-sel font-semibold" : "text-muted-text")}
                    >
                      <span className={active ? "text-brand" : "text-faint"}>{ICONS[item.label]}</span>
                      {item.label}
                    </Link>
                  );
                })}
                <Link
                  href="/notifications"
                  onClick={close}
                  aria-current={pathname === "/notifications" ? "page" : undefined}
                  className={cn(itemClass, pathname === "/notifications" ? "bg-brand-sel font-semibold" : "text-muted-text")}
                >
                  <Bell className="size-[18px] text-faint" aria-hidden="true" />
                  알림
                </Link>
              </nav>
            )}

            <section aria-labelledby="mnav-projects" className="flex flex-col gap-1">
              <h2 id="mnav-projects" className="px-3 text-xs font-medium text-faint">
                프로젝트
              </h2>
              <ul className="flex flex-col gap-0.5">
                {projects.map((p) => {
                  const selected = p.id === current?.id;
                  return (
                    <li key={p.id}>
                      <Link
                        href={`/p/${p.id}/tickets`}
                        onClick={close}
                        aria-current={selected ? "true" : undefined}
                        className={cn(itemClass, selected ? "font-medium" : "text-muted-text")}
                      >
                        <span className="min-w-0 flex-1 truncate">{p.name}</span>
                        {selected && <Check className="size-4 shrink-0 text-brand" aria-hidden="true" />}
                      </Link>
                    </li>
                  );
                })}
                <li>
                  <Link href="/projects/new" onClick={close} className={cn(itemClass, "text-muted-text")}>
                    <Plus className="size-4" aria-hidden="true" />새 프로젝트
                  </Link>
                </li>
              </ul>
            </section>
            {extra && <div className="mt-auto border-t border-line px-1 pt-4">{extra}</div>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
