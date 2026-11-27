"use client";

import { useRef, useTransition } from "react";
import Link from "next/link";
import { useQueryStates } from "nuqs";
import { createColumnHelper, tableFeatures, useTable } from "@tanstack/react-table";
import { ArrowDown, Inbox, Loader2, User, Users, X } from "lucide-react";
import { aiScopeStyle, Sparkle } from "@/components/review/ai-frame";
import type { AiNoteView, TicketRow } from "@/lib/tickets/list";
import { CATEGORY_LABEL, STATUS_LABEL, ticketRef, URGENCY_LABEL, URGENCY_LEVEL } from "@/lib/tickets/labels";
import { FILTER_STATUSES, FILTER_URGENCIES, LIST_CAP, listParsers, VIEW_HINT, VIEW_LABEL, type TicketView } from "@/lib/tickets/views";
import { listStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { StatusText } from "./status-badge";
import { UrgencyBars } from "./urgency-bars";
import { RememberListQuery } from "./back-to-list";

type Props = {
  projectId: string;
  provider: string;
  view: TicketView;
  views: TicketView[];
  counts: Partial<Record<TicketView, number>>;
  rows: TicketRow[];
  total: number;
};

const features = tableFeatures({});
const helper = createColumnHelper<typeof features, TicketRow>();

/** 열 정의(모듈 범위에 두어 렌더마다 새로 만들지 않는다). 셀 모양은 아래 renderCell이 정한다. */
const columns = helper.columns([
  helper.accessor("number", { id: "number", header: "번호" }),
  helper.accessor("title", { id: "title", header: "제목" }),
  helper.accessor("category", { id: "category", header: "카테고리" }),
  helper.accessor("urgency", { id: "urgency", header: "긴급도" }),
  helper.accessor("status", { id: "status", header: "상태" }),
  helper.accessor((r) => r.target.label, { id: "target", header: "담당 대상" }),
  helper.accessor("assigneeName", { id: "assignee", header: "담당자" }),
  helper.accessor("aiNote", { id: "ai", header: "AI 비고" }),
]);

/**
 * 좁은 화면에서는 덜 중요한 열을 숨기고, 숨긴 값은 제목 칸의 둘째 줄이 대신 보여 준다.
 * md 미만은 표 대신 카드처럼 보인다: 한 줄에 번호·상태, 다음 줄에 제목과 요약(긴급도·카테고리·담당).
 * md~lg는 담당 대상 칸 아래에 담당자를 함께 보이고, 늘 비어 있을 수 있는 AI 비고 칸은 xl부터 둔다.
 */
const COL_CLASS: Record<string, string> = {
  number: "w-[72px] whitespace-nowrap max-md:block max-md:col-start-1 max-md:row-start-1",
  title: "min-w-[240px] max-md:block max-md:col-span-2 max-md:row-start-2 max-md:min-w-0 max-md:pt-1.5!",
  category: "hidden xl:table-cell w-[96px]",
  urgency: "w-[92px] whitespace-nowrap max-md:hidden",
  status: "w-[120px] whitespace-nowrap max-md:block max-md:w-auto max-md:col-start-2 max-md:row-start-1 max-md:justify-self-end",
  target: "w-[150px] max-md:hidden",
  assignee: "hidden lg:table-cell w-[110px]",
  ai: "hidden xl:table-cell w-[150px]",
};
/** md 미만에서 표의 줄·칸을 카드 격자로 바꾸는 클래스. */
const CARD_ROW = "max-md:grid max-md:grid-cols-[minmax(0,1fr)_auto] max-md:items-center max-md:gap-x-3 max-md:px-5 max-md:py-4";
const CARD_CELL = "max-md:p-0!";

const TARGET_ICON = { lead: Inbox, group: Users, user: User } as const;

function AiNoteChip({ note, provider }: { note: AiNoteView; provider: string }) {
  const text = note.kind === "recommendation" ? `추천 ${note.targetLabel}` : note.kind === "duplicate" ? `중복 후보 ${note.count}` : "해소 가능";
  const title = note.kind === "recommendation" ? note.reason : undefined;
  return (
    <span
      title={title}
      className="ai-scope inline-flex max-w-full items-center gap-1 rounded-full border border-ai-ring bg-ai-tint px-2 py-0.5 text-xs font-medium text-ai-text"
      style={aiScopeStyle(provider)}
    >
      <Sparkle className="size-3" />
      <span className="truncate">{text}</span>
    </span>
  );
}

function renderCell(id: string, r: TicketRow, projectId: string, provider: string) {
  switch (id) {
    case "number":
      return <span className="font-mono text-xs text-faint">{ticketRef(r.number)}</span>;
    case "title":
      return (
        <div className="flex min-w-0 flex-col gap-1.5">
          <Link
            href={`/p/${projectId}/tickets/${r.id}`}
            className="text-[15px] font-medium leading-[1.45] text-text no-underline outline-none [overflow-wrap:anywhere] after:absolute after:inset-0 after:content-[''] focus-visible:after:rounded-[10px] focus-visible:after:ring-[3px] focus-visible:after:ring-ring/40"
          >
            {r.title}
          </Link>
          <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs text-muted-text">
            <span className="inline-flex items-center gap-1.5 md:hidden" title={`긴급도 ${URGENCY_LABEL[r.urgency]}`}>
              <UrgencyBars level={URGENCY_LEVEL[r.urgency]} className="h-3" />
              {URGENCY_LABEL[r.urgency]}
            </span>
            <span>{r.authorName}</span>
            <span className="xl:hidden">{CATEGORY_LABEL[r.category]}</span>
            <span className="md:hidden">
              <span className="sr-only">담당 </span>
              {r.target.label}
              {r.assigneeName && ` · ${r.assigneeName}`}
            </span>
            {r.aiNote && (
              <span className="xl:hidden">
                <AiNoteChip note={r.aiNote} provider={provider} />
              </span>
            )}
          </span>
        </div>
      );
    case "category":
      return <span className="text-sm text-muted-text">{CATEGORY_LABEL[r.category]}</span>;
    case "urgency":
      return (
        <span className="inline-flex items-center gap-2 text-sm text-text" title={`긴급도 ${URGENCY_LABEL[r.urgency]}`}>
          <UrgencyBars level={URGENCY_LEVEL[r.urgency]} />
          <span className="text-muted-text">{URGENCY_LABEL[r.urgency]}</span>
        </span>
      );
    case "status":
      return <StatusText status={r.status} className="text-sm" />;
    case "target": {
      const Icon = TARGET_ICON[r.target.kind];
      return (
        <span className="flex min-w-0 flex-col gap-0.5">
          <span className="inline-flex min-w-0 items-center gap-1.5 text-sm text-muted-text">
            <Icon className="size-3.5 shrink-0 text-faint" aria-hidden />
            <span className="truncate">{r.target.label}</span>
          </span>
          {/* 담당자 칸이 숨는 폭(md~lg)에서는 여기서 함께 보인다. */}
          <span className="truncate pl-5 text-xs text-faint lg:hidden">{r.assigneeName ? `담당 ${r.assigneeName}` : "담당자 없음"}</span>
        </span>
      );
    }
    case "assignee":
      return r.assigneeName ? (
        <span className="text-sm">{r.assigneeName}</span>
      ) : (
        <span className="text-sm text-faint">
          <span aria-hidden="true">—</span>
          <span className="sr-only">없음</span>
        </span>
      );
    case "ai":
      return r.aiNote ? (
        <AiNoteChip note={r.aiNote} provider={provider} />
      ) : (
        <span className="text-sm text-faint">
          <span aria-hidden="true">—</span>
          <span className="sr-only">없음</span>
        </span>
      );
  }
  return null;
}

/**
 * 티켓 목록: 뷰 탭(뷔페식 큐) + 긴급도·상태 필터 + 표(TanStack Table, 서버가 거른 행).
 * 탭·필터는 nuqs로 URL에 남아 새로고침해도 유지되고, 바꾸면 서버가 다시 거른다(shallow: false).
 */
export function TicketTable({ projectId, provider, view, views, counts, rows, total }: Props) {
  const [pending, startTransition] = useTransition();
  const [params, setParams] = useQueryStates(listParsers, { shallow: false, startTransition, history: "replace" });
  const active = params.view && views.includes(params.view) ? params.view : view;
  const tabRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const table = useTable({ features, columns, data: rows });

  const toggle = <T extends string>(key: "urgency" | "status", list: readonly T[], value: T) => {
    const next = list.includes(value) ? list.filter((v) => v !== value) : [...list, value];
    void setParams({ [key]: next.length ? next : null });
  };
  const filtered = params.urgency.length > 0 || params.status.length > 0;

  const onTabKey = (e: React.KeyboardEvent, i: number) => {
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    const to = e.key === "Home" ? 0 : e.key === "End" ? views.length - 1 : d ? (i + d + views.length) % views.length : -1;
    if (to < 0) return;
    e.preventDefault();
    tabRefs.current[to]?.focus();
    void setParams({ view: views[to] });
  };

  return (
    <div className="flex flex-col gap-6">
      <RememberListQuery projectId={projectId} />
      <div className="flex flex-col gap-4">
        <div role="tablist" aria-label="보기" className="flex flex-wrap gap-1.5">
          {views.map((v, i) => {
            const selected = v === active;
            return (
              <button
                key={v}
                ref={(el) => {
                  tabRefs.current[i] = el;
                }}
                type="button"
                role="tab"
                id={`tab-${v}`}
                aria-selected={selected}
                aria-controls="ticket-panel"
                tabIndex={selected ? 0 : -1}
                title={VIEW_HINT[v]}
                onKeyDown={(e) => onTabKey(e, i)}
                onClick={() => void setParams({ view: v })}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] pointer-coarse:min-h-11 pointer-coarse:px-4 transition-[transform,background-color,color,border-color] duration-[120ms] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
                  selected ? "border-text bg-text text-bg" : "border-line text-muted-text hover:bg-sunken",
                )}
              >
                {VIEW_LABEL[v]}
                <span className={cn("font-mono text-xs", selected ? "text-bg/70" : "text-faint")}>{counts[v] ?? 0}</span>
              </button>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
          <FilterGroup
            label="긴급도"
            options={FILTER_URGENCIES.map((u) => ({
              value: u,
              label: URGENCY_LABEL[u],
              icon: <UrgencyBars level={URGENCY_LEVEL[u]} className="h-3" />,
            }))}
            selected={params.urgency}
            onToggle={(u) => toggle("urgency", params.urgency, u)}
          />
          <FilterGroup
            label="상태"
            options={FILTER_STATUSES.map((s) => ({ value: s, label: STATUS_LABEL[s] }))}
            selected={params.status}
            onToggle={(s) => toggle("status", params.status, s)}
          />
          {filtered && (
            <button
              type="button"
              onClick={() => void setParams({ urgency: null, status: null })}
              className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-muted-text pointer-coarse:min-h-11 transition-colors hover:bg-sunken hover:text-text"
            >
              <X className="size-3.5" aria-hidden />
              필터 지우기
            </button>
          )}
        </div>
      </div>

      <div
        id="ticket-panel"
        role="tabpanel"
        aria-labelledby={`tab-${active}`}
        aria-busy={pending}
        className={cn("transition-opacity duration-200", pending && "opacity-60")}
      >
        <div className="mb-3 flex flex-wrap items-center justify-between gap-x-4 gap-y-1 text-[13px] text-muted-text">
          <p aria-live="polite" className="inline-flex items-center gap-2">
            {pending ? (
              <>
                <Loader2 className="size-3.5 animate-spin text-brand" aria-hidden="true" />
                목록을 불러오는 중이에요
              </>
            ) : (
              <>
                {VIEW_LABEL[view]} <span className="font-mono text-text">{total}</span>건
              </>
            )}
          </p>
          <p className="inline-flex items-center gap-1 text-faint">
            <ArrowDown className="size-3" aria-hidden="true" />
            긴급도 높은 순, 같으면 최근 변경 순
          </p>
        </div>
        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-[14px] border border-dashed border-line bg-surface px-6 py-16 text-center">
            <p className="text-[15px] font-medium">{filtered ? "조건에 맞는 티켓이 없어요" : `${VIEW_LABEL[view]}가 비어 있어요`}</p>
            <p className="max-w-sm text-sm text-muted-text">{filtered ? "필터를 줄여 보세요." : VIEW_HINT[view]}</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-[14px] border border-line bg-surface">
            <table aria-label="티켓 목록" className="w-full border-collapse text-left max-md:block">
              <thead className="max-md:hidden">
                {table.getHeaderGroups().map((g) => (
                  <tr key={g.id} className="border-b border-line">
                    {g.headers.map((h) => (
                      <th
                        key={h.id}
                        scope="col"
                        aria-sort={h.column.id === "urgency" ? "descending" : undefined}
                        className={cn("px-4 py-3 text-xs font-medium text-faint first:pl-6 last:pr-6", COL_CLASS[h.column.id])}
                      >
                        {h.isPlaceholder ? null : (
                          <span className="inline-flex items-center gap-1">
                            <table.FlexRender header={h} />
                            {h.column.id === "urgency" && <ArrowDown className="size-3" aria-hidden="true" />}
                          </span>
                        )}
                      </th>
                    ))}
                  </tr>
                ))}
              </thead>
              <tbody className="max-md:block">
                {table.getRowModel().rows.map((row, i) => (
                  <tr
                    key={row.id}
                    className={cn("rise relative border-b border-line transition-colors duration-150 last:border-b-0 hover:bg-sunken/60", CARD_ROW)}
                    style={listStagger(i, 0.03)}
                  >
                    {row.getAllCells().map((cell) => (
                      <td key={cell.id} className={cn("px-4 py-4 align-top first:pl-6 last:pr-6", CARD_CELL, COL_CLASS[cell.column.id])}>
                        {renderCell(cell.column.id, row.original, projectId, provider)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {total > rows.length && (
          <p className="mt-3 text-[13px] text-muted-text">
            {total}건 중 긴급도·최근 순으로 {LIST_CAP}건만 보여요. 필터로 좁혀 보세요.
          </p>
        )}
      </div>
    </div>
  );
}

function FilterGroup<T extends string>({
  label,
  options,
  selected,
  onToggle,
}: {
  label: string;
  options: { value: T; label: string; icon?: React.ReactNode }[];
  selected: readonly T[];
  onToggle: (v: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex flex-wrap items-center gap-1.5">
      <span aria-hidden className="mr-1 text-xs text-faint">
        {label}
      </span>
      {options.map((o) => {
        const on = selected.includes(o.value);
        return (
          <button
            key={o.value}
            type="button"
            aria-pressed={on}
            onClick={() => onToggle(o.value)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[13px] pointer-coarse:min-h-11 pointer-coarse:px-3.5 transition-[transform,background-color,border-color,color] duration-[120ms] hover:-translate-y-px focus-visible:outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40",
              on ? "border-brand bg-brand/10 text-text" : "border-line text-muted-text hover:bg-sunken",
            )}
          >
            {o.icon}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
