"use client";

import { useId, useState } from "react";
import { Check, ChevronsUpDown, Inbox, User, Users } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { AiLabel, aiScopeStyle, Sparkle } from "@/components/review/ai-frame";
import type { TargetOptions } from "@/lib/tickets/detail";
import type { Target } from "@/lib/tickets/targets";
import { describeTarget } from "@/lib/tickets/target-label";
import { cn } from "@/lib/utils";

export type TargetRecommendation = { target: Target; reason: string; provider?: string | null };

const keyOf = (t: Target) => (t === null ? "lead" : t.kind === "user" ? `user:${t.userId}` : `group:${t.groupId}`);


const ICON = { lead: Inbox, group: Users, user: User } as const;
const ROLE_LABEL = { lead: "리드", developer: "개발자", requester: "요청자" } as const;

/**
 * 담당 대상 고르기. 사람(요청자 역할 제외)과 그룹을 한 목록에서 검색하고, "비워 두기(리드에게)"를 고를 수 있다.
 * 추천이 있으면 그 항목에 ✦ 표시를 하고, 아래에 이유 한 줄을 보인다. 키보드: 열고 화살표로 이동, Enter로 고른다.
 */
export function TargetPicker({
  projectId,
  value,
  onChange,
  options,
  recommended,
  id,
  label = "담당 대상",
  disabled,
  invalid,
}: {
  projectId: string;
  value: Target;
  onChange: (t: Target) => void;
  options: TargetOptions;
  recommended?: TargetRecommendation | null;
  id?: string;
  label?: string;
  disabled?: boolean;
  invalid?: boolean;
}) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const listId = useId();
  const current = describeTarget(value, options);
  const CurrentIcon = ICON[current.kind];
  const recKey = recommended?.target !== undefined && recommended.reason ? keyOf(recommended.target) : null;
  const isRecommended = (t: Target) => recKey !== null && keyOf(t) === recKey;

  const pick = (t: Target) => {
    onChange(t);
    setOpen(false);
  };

  const item = (t: Target, text: string, sub?: string) => {
    const k = keyOf(t);
    const Icon = ICON[t === null ? "lead" : t.kind];
    const selected = keyOf(value) === k;
    return (
      <CommandItem
        key={k}
        value={`${text} ${sub ?? ""} ${k}`}
        onSelect={() => pick(t)}
        className="flex items-center gap-2.5 rounded-md px-2 py-2 text-sm"
      >
        <Icon className="size-4 text-faint" aria-hidden />
        <span className="flex min-w-0 flex-1 flex-col">
          <span className="truncate">{text}</span>
          {sub && <span className="truncate text-xs text-faint">{sub}</span>}
        </span>
        {isRecommended(t) && (
          <span className="ai-scope inline-flex items-center gap-1 rounded-full bg-ai-tint px-2 py-0.5 text-xs font-medium text-ai-text" style={aiScopeStyle(recommended?.provider)}>
            <Sparkle className="size-3" />
            추천
          </span>
        )}
        <Check className={cn("size-4 text-brand", selected ? "opacity-100" : "opacity-0")} aria-hidden />
      </CommandItem>
    );
  };

  return (
    <div className="flex flex-col gap-2" data-project={projectId}>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button
            id={id}
            type="button"
            role="combobox"
            aria-label={label}
            aria-expanded={open}
            aria-controls={listId}
            aria-haspopup="listbox"
            aria-invalid={invalid || undefined}
            aria-describedby={recKey ? reasonId : undefined}
            disabled={disabled}
            className="flex h-11 w-full items-center gap-2.5 rounded-[10px] border border-line bg-surface px-3 text-left text-[15px] outline-none transition-[border-color,box-shadow] duration-[120ms] hover:border-faint/60 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30 disabled:opacity-50 aria-invalid:border-destructive"
          >
            <CurrentIcon className="size-4 text-faint" aria-hidden />
            <span className="min-w-0 flex-1 truncate">{current.label}</span>
            {current.kind === "group" && <span className="text-xs text-faint">그룹</span>}
            {isRecommended(value) && (
              <span className="ai-scope inline-flex items-center gap-1 rounded-full bg-ai-tint px-2 py-0.5 text-xs font-medium text-ai-text" style={aiScopeStyle(recommended?.provider)}>
                <Sparkle className="size-3" />
                추천
              </span>
            )}
            <ChevronsUpDown className="size-4 text-faint" aria-hidden />
          </button>
        </PopoverTrigger>
        <PopoverContent id={listId} align="start" collisionPadding={{ top: 72, bottom: 12, left: 12, right: 12 }} className="w-[var(--radix-popover-trigger-width)] min-w-[280px] p-0">
          <Command>
            <CommandInput placeholder="사람이나 그룹 검색" aria-label="사람이나 그룹 검색" />
            <CommandList>
              <CommandEmpty>찾는 대상이 없어요.</CommandEmpty>
              <CommandGroup>{item(null, "비워 두기(리드에게)", "리드가 보고 대상을 정해요")}</CommandGroup>
              {options.groups.length > 0 && (
                <CommandGroup heading="그룹">{options.groups.map((g) => item({ kind: "group", groupId: g.id }, g.name, g.scope || undefined))}</CommandGroup>
              )}
              {options.people.length > 0 && (
                <CommandGroup heading="사람">
                  {options.people.map((p) => item({ kind: "user", userId: p.id }, p.name, ROLE_LABEL[p.role]))}
                </CommandGroup>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
      {recKey && recommended && (
        <p id={reasonId} className="ai-scope flex flex-wrap items-baseline gap-x-2 text-[13px] leading-[1.6] text-muted-text" style={aiScopeStyle(recommended.provider)}>
          <AiLabel provider={recommended.provider} suffix="추천" className="text-[13px]" />
          <span>{recommended.reason}</span>
        </p>
      )}
    </div>
  );
}
