import Link from "next/link";
import { ExternalLink, FileText, GitCommitHorizontal, GitPullRequest, Ticket } from "lucide-react";
import type { TicketRefView } from "@/lib/tickets/detail";
import { ticketRef } from "@/lib/tickets/labels";

export type EvidenceItem = { ref: string; note?: string };

/** GitHub 레포 주소(https://github.com/owner/repo[.git])의 기본 URL. 아니면 null. */
export function githubBase(repoUrl: string | null | undefined): string | null {
  const m = repoUrl?.match(/^https:\/\/github\.com\/([\w.-]+)\/([\w.-]+?)(?:\.git)?\/?$/);
  return m ? `https://github.com/${m[1]}/${m[2]}` : null;
}

const chip =
  "inline-flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface px-2.5 py-1.5 text-[13px] text-text no-underline transition-[transform,border-color] duration-[120ms] hover:-translate-y-px hover:border-faint/60";

/**
 * 근거 하나: `ticket:` → 티켓 상세, `commit:`/`pr:` → GitHub, `doc:` → 도메인 지식(레포 화면).
 * 형식을 모르는 근거는 글자로만 보인다(정규화가 이미 걸렀으므로 드물다).
 */
export function EvidenceLink({
  item,
  projectId,
  repoUrl,
  refs,
  weak,
}: {
  item: EvidenceItem;
  projectId: string;
  repoUrl?: string | null;
  refs?: Record<string, TicketRefView>;
  weak?: boolean;
}) {
  const i = item.ref.indexOf(":");
  const kind = i > 0 ? item.ref.slice(0, i) : "";
  const value = i > 0 ? item.ref.slice(i + 1) : item.ref;
  const gh = githubBase(repoUrl);
  const note = item.note ? <span className="min-w-0 truncate text-muted-text">{item.note}</span> : null;
  const guess = weak ? <span className="rounded-full bg-sunken px-1.5 text-[11px] text-muted-text">추정</span> : null;

  if (kind === "ticket") {
    const t = refs?.[value];
    return (
      <Link href={`/p/${projectId}/tickets/${value}`} className={chip}>
        <Ticket className="size-3.5 text-faint" aria-hidden />
        <span className="font-mono text-faint">{t ? ticketRef(t.number) : "티켓"}</span>
        <span className="min-w-0 truncate">{t?.title ?? item.note ?? ""}</span>
        {guess}
      </Link>
    );
  }
  if ((kind === "commit" || kind === "pr") && gh) {
    const href = kind === "commit" ? `${gh}/commit/${encodeURIComponent(value)}` : `${gh}/pull/${encodeURIComponent(value)}`;
    const Icon = kind === "commit" ? GitCommitHorizontal : GitPullRequest;
    return (
      <a href={href} target="_blank" rel="noopener noreferrer" className={chip} style={weak ? { borderStyle: "dashed" } : undefined}>
        <Icon className="size-3.5 text-faint" aria-hidden />
        <span className="font-mono text-faint">{kind === "commit" ? value.slice(0, 7) : `PR #${value}`}</span>
        {note}
        {guess}
        <ExternalLink className="size-3 text-faint" aria-hidden />
        <span className="sr-only">(GitHub, 새 창)</span>
      </a>
    );
  }
  if (kind === "doc") {
    return (
      <Link href={`/p/${projectId}/repo?doc=${encodeURIComponent(value)}`} className={chip}>
        <FileText className="size-3.5 text-faint" aria-hidden />
        <span>도메인 지식</span>
        {note}
        {guess}
      </Link>
    );
  }
  return (
    <span className={chip}>
      <span className="font-mono text-faint">{item.ref}</span>
      {note}
    </span>
  );
}
