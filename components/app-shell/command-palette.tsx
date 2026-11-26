"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Bell, FolderGit2, Settings, Ticket, ArrowRightLeft, Loader2, Search } from "lucide-react";
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
import { searchTicketsAction } from "@/app/p/[projectId]/tickets/actions";
import type { TicketHit } from "@/lib/tickets/list";
import { STATUS_LABEL, ticketRef } from "@/lib/tickets/labels";
import { StatusDot } from "@/components/ticket/status-badge";

type Entry = { id: string; label: string; hint?: string; href: string; keywords: string[]; icon: React.ReactNode };

const ICONS: Record<string, React.ReactNode> = {
  티켓: <Ticket />,
  레포: <FolderGit2 />,
  관리자: <Settings />,
};

/**
 * 명령 팔레트: 페이지 이동 + 지금 프로젝트의 티켓 검색. `#12`는 12번 티켓, 그 밖의 글자는 제목·본문 검색(searchTicketsAction,
 * 멤버만). 검색은 입력이 멈춘 뒤 0.2초에 서버에 묻고, 늦게 온 이전 결과는 버린다.
 */
export function CommandPalette({
  current,
  projects,
}: {
  current: { id: string; role: MemberRole } | null;
  projects: { id: string; name: string }[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<{ query: string; items: TicketHit[] }>({ query: "", items: [] });
  const latest = useRef("");
  const projectId = current?.id ?? null;
  const q = query.trim();
  const searching = !!projectId && q.length > 0 && hits.query !== q;

  useEffect(() => {
    latest.current = q;
    if (!projectId || !q) return;
    const id = window.setTimeout(async () => {
      const items = await searchTicketsAction(projectId, q).catch(() => [] as TicketHit[]);
      if (latest.current === q) setHits({ query: q, items });
    }, 200);
    return () => window.clearTimeout(id);
  }, [projectId, q]);

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
    setQuery("");
    router.push(href);
  }

  const ticketItems = projectId && hits.query === q ? hits.items : [];

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
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery("");
      }}
      title="명령 팔레트"
      description="이동할 페이지나 티켓을 검색해 고르세요."
      showCloseButton={false}
    >
      <CommandInput placeholder="이동할 곳을 검색하세요" value={query} onValueChange={setQuery} />
      <CommandList>
        <CommandEmpty>{searching ? "찾는 중이에요" : "일치하는 항목이 없어요"}</CommandEmpty>
        {ticketItems.length > 0 && (
          <CommandGroup heading="티켓">
            {ticketItems.map((t) => (
              <CommandItem
                key={t.id}
                value={`ticket ${t.id} ${ticketRef(t.number)} ${t.title}`}
                keywords={[q, ticketRef(t.number), t.title]}
                onSelect={() => go(`/p/${projectId}/tickets/${t.id}`)}
              >
                <Ticket />
                <span className="font-mono text-xs text-faint">{ticketRef(t.number)}</span>
                <span className="min-w-0 truncate">{t.title}</span>
                <span className="ml-auto inline-flex shrink-0 items-center gap-1.5 text-xs text-faint">
                  <StatusDot status={t.status} />
                  {STATUS_LABEL[t.status]}
                </span>
              </CommandItem>
            ))}
          </CommandGroup>
        )}
        <CommandGroup heading="페이지">{pages.map(render)}</CommandGroup>
        {switches.length > 0 && <CommandGroup heading="프로젝트">{switches.map(render)}</CommandGroup>}
      </CommandList>
      <div className="flex items-center gap-2 border-t border-line px-3 py-2 text-xs text-faint">
        {searching ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : <Search className="size-3.5" aria-hidden="true" />}
        <span>{projectId ? "#번호로 바로 가거나 제목으로 찾아요" : "프로젝트를 열면 티켓도 찾을 수 있어요"}</span>
        <kbd className="ml-auto rounded border border-line px-1.5 font-mono text-[11px]">Esc</kbd>
      </div>
    </CommandDialog>
  );
}

export function openPalette() {
  window.dispatchEvent(new Event("mpm:open-palette"));
}
