"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, FolderGit2, Settings, Ticket, ArrowRightLeft, Search } from "lucide-react";
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { navItems } from "./nav";
import type { MemberRole } from "@/lib/auth-roles";

type Entry = { id: string; label: string; hint?: string; href: string; keywords: string[]; icon: React.ReactNode };

const ICONS: Record<string, React.ReactNode> = {
  티켓: <Ticket />,
  레포: <FolderGit2 />,
  관리자: <Settings />,
};

/** 페이지 이동 명령만 둔다. 티켓 검색은 목록 화면과 함께 붙는다. */
export function CommandPalette({
  current,
  projects,
}: {
  current: { id: string; role: MemberRole } | null;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mpm:open-palette", onOpen);
    // 단축키가 붙었다는 표시(E2E가 기다리는 신호).
    document.documentElement.setAttribute("data-shell-ready", "");
    return () => {
      document.documentElement.removeAttribute("data-shell-ready");
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("mpm:open-palette", onOpen);
    };
  }, []);

  const { pages, switches } = useMemo(() => {
    const pages: Entry[] = [
      ...(current
        ? navItems(current.id, current.role).map((n) => ({
            id: `page-${n.label}`,
            label: n.label,
            hint: n.label === "티켓" ? "목록" : undefined,
            href: n.href,
            keywords: [n.label],
            icon: ICONS[n.label],
          }))
        : []),
      { id: "page-notifications", label: "알림", href: "/notifications", keywords: ["알림", "notifications"], icon: <Bell /> },
    ];
    const switches: Entry[] = projects
      .filter((p) => p.id !== current?.id)
      .map((p) => ({
        id: `project-${p.id}`,
        label: p.name,
        hint: "프로젝트 전환",
        href: `/p/${p.id}/tickets`,
        keywords: ["프로젝트", p.name],
        icon: <ArrowRightLeft />,
      }));
    return { pages, switches };
  }, [current, projects]);

  function go(href: string) {
    setOpen(false);
    router.push(href);
  }

  const render = (e: Entry) => (
    <CommandItem key={e.id} value={e.label} keywords={e.keywords} onSelect={() => go(e.href)}>
      {e.icon}
      <span>{e.label}</span>
      {e.hint && <span className="ml-auto text-xs text-faint">{e.hint}</span>}
    </CommandItem>
  );

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      title="명령 팔레트"
      description="이동할 페이지를 검색해 고르세요."
      showCloseButton={false}
    >
      <CommandInput placeholder="이동할 곳을 검색하세요" />
      <CommandList>
        <CommandEmpty>일치하는 항목이 없어요</CommandEmpty>
        <CommandGroup heading="페이지">{pages.map(render)}</CommandGroup>
        {switches.length > 0 && <CommandGroup heading="프로젝트">{switches.map(render)}</CommandGroup>}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-faint">
        <Search className="size-3.5" aria-hidden="true" />
        <span>티켓 검색은 목록 화면에서 곧 쓸 수 있어요</span>
        <kbd className="ml-auto rounded border border-line px-1.5 font-mono text-[11px]">Esc</kbd>
      </div>
    </CommandDialog>
  );
}

export function openPalette() {
  window.dispatchEvent(new Event("mpm:open-palette"));
}
