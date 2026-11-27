"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check, LogOut, Monitor, Moon, Plus, RotateCcw, Sun } from "lucide-react";
import { toast } from "sonner";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { authClient } from "@/lib/auth-client";
import { cn } from "@/lib/utils";
import type { ThemePreference } from "@/lib/db/schema";
import { ACCENT_PRESETS, accentPair, normalizeHex, onAccent } from "@/lib/theme/accent";
import { applyAccentVars, applyTheme, clearAccentVars } from "@/lib/theme/client";
import { savePreferencesAction } from "./actions";

export type ProjectAccent = {
  light: string;
  dark: string;
  onLight: string;
  onDark: string;
  providerName: string;
  label: string;
};

const THEMES: { value: ThemePreference; label: string; icon: React.ReactNode }[] = [
  { value: "light", label: "라이트", icon: <Sun className="size-4" aria-hidden="true" /> },
  { value: "dark", label: "다크", icon: <Moon className="size-4" aria-hidden="true" /> },
  { value: "system", label: "시스템", icon: <Monitor className="size-4" aria-hidden="true" /> },
];

function accentVars(hex: string) {
  const p = accentPair(hex);
  return {
    "--accent-l": p.light,
    "--accent-d": p.dark,
    "--on-accent-l": onAccent(p.light),
    "--on-accent-d": onAccent(p.dark),
  };
}

export function useSavePreferences() {
  const router = useRouter();
  const [, startTransition] = useTransition();
  return function save(patch: { theme?: ThemePreference; accentOverride?: string | null }, successMessage?: string) {
    startTransition(async () => {
      const res = await savePreferencesAction(patch);
      if (!res.ok) {
        toast.error(res.error);
        clearAccentVars();
        router.refresh();
        return;
      }
      if (successMessage) toast.success(successMessage);
    });
  };
}

export function ProfileMenu({
  user,
  theme,
  accentOverride,
  projectAccent,
}: {
  user: { name: string; email: string };
  theme: ThemePreference;
  accentOverride: string | null;
  projectAccent: ProjectAccent;
}) {
  const router = useRouter();
  const save = useSavePreferences();
  const [themePref, setThemePref] = useState(theme);
  const [override, setOverride] = useState(accentOverride);
  const [hex, setHex] = useState("");
  const [hexError, setHexError] = useState<string | null>(null);
  // 서버가 저장된 값을 새로 내려주면 맞춘다. 컴포넌트를 key로 다시 만들면 열려 있던 팝오버가 닫힌다.
  const [seen, setSeen] = useState({ theme, accentOverride });
  if (seen.theme !== theme || seen.accentOverride !== accentOverride) {
    setSeen({ theme, accentOverride });
    setThemePref(theme);
    setOverride(accentOverride);
  }

  const effective = (override ?? projectAccent.light).toUpperCase();
  const initial = user.name.trim().slice(0, 1) || "?";

  function chooseTheme(next: ThemePreference) {
    setThemePref(next);
    applyTheme(next);
    save({ theme: next });
  }

  function chooseAccent(raw: string) {
    const value = normalizeHex(raw);
    if (!value) {
      setHexError("#RRGGBB 형식으로 입력해 주세요");
      return;
    }
    setHexError(null);
    setHex("");
    setOverride(value);
    applyAccentVars(accentVars(value));
    save({ accentOverride: value }, "강조색을 바꿨어요");
  }

  function resetAccent() {
    setHexError(null);
    setHex("");
    setOverride(null);
    applyAccentVars({
      "--accent-l": projectAccent.light,
      "--accent-d": projectAccent.dark,
      "--on-accent-l": projectAccent.onLight,
      "--on-accent-d": projectAccent.onDark,
    });
    save({ accentOverride: null }, `프로젝트 기본 강조색(${projectAccent.providerName})으로 돌아갔어요`);
  }

  async function signOut() {
    await authClient.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="프로필 메뉴"
          className="flex size-9 items-center justify-center rounded-full border pointer-coarse:size-11 border-line bg-sunken text-[13px] font-semibold text-text transition-[transform] duration-[120ms] hover:-translate-y-px"
        >
          {initial}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" sideOffset={10} className="w-80 p-0">
        <div className="flex items-center gap-3 border-b border-line p-4">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-full bg-sunken text-sm font-semibold">
            {initial}
          </div>
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold leading-snug">{user.name}</p>
            <p className="truncate text-xs text-faint">{user.email}</p>
          </div>
        </div>

        <section className="flex flex-col gap-2 border-b border-line p-4" aria-labelledby="pm-theme">
          <h3 id="pm-theme" className="text-xs font-medium text-faint">
            테마
          </h3>
          <div role="radiogroup" aria-labelledby="pm-theme" className="grid grid-cols-3 gap-1 rounded-lg bg-sunken p-1">
            {THEMES.map((t) => (
              <button
                key={t.value}
                type="button"
                role="radio"
                aria-checked={themePref === t.value}
                onClick={() => chooseTheme(t.value)}
                className={cn(
                  "flex items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] pointer-coarse:min-h-11 transition-colors duration-[120ms]",
                  themePref === t.value ? "bg-surface font-semibold text-text" : "text-muted-text hover:text-text",
                )}
              >
                {t.icon}
                {t.label}
              </button>
            ))}
          </div>
        </section>

        <section className="flex flex-col gap-3 border-b border-line p-4" aria-labelledby="pm-accent">
          <div className="flex items-baseline justify-between">
            <h3 id="pm-accent" className="text-xs font-medium text-faint">
              내 강조색
            </h3>
            <span className="text-xs text-faint">
              {override ? <span className="font-mono">{effective}</span> : `프로젝트 기본값 (${projectAccent.providerName})`}
            </span>
          </div>
          <div className="flex gap-2">
            {ACCENT_PRESETS.map((p) => {
              const selected = effective === p.accent;
              return (
                <button
                  key={p.provider}
                  type="button"
                  aria-label={p.label}
                  aria-pressed={selected}
                  onClick={() => chooseAccent(p.accent)}
                  className={cn(
                    "flex flex-1 items-center gap-2 rounded-lg border px-2.5 py-2 text-[13px] pointer-coarse:min-h-11 transition-[transform,border-color] duration-[120ms] hover:-translate-y-px",
                    selected ? "border-brand" : "border-line",
                  )}
                >
                  <span
                    aria-hidden="true"
                    className="flex size-4 shrink-0 items-center justify-center rounded-full"
                    style={{ background: p.accent }}
                  >
                    {selected && <Check className="size-3 text-white" strokeWidth={3} />}
                  </span>
                  <span className="truncate">{p.label.split(" ")[1]}</span>
                </button>
              );
            })}
          </div>
          <form
            className="flex gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              chooseAccent(hex);
            }}
          >
            <div className="flex flex-1 flex-col gap-1">
              <label htmlFor="pm-hex" className="sr-only">
                직접 입력
              </label>
              <Input
                id="pm-hex"
                value={hex}
                onChange={(e) => {
                  setHex(e.target.value);
                  setHexError(null);
                }}
                placeholder="직접 입력  #7C3AED"
                spellCheck={false}
                autoComplete="off"
                aria-invalid={hexError ? true : undefined}
                aria-describedby={hexError ? "pm-hex-error" : undefined}
                className="h-9 font-mono text-[13px]"
              />
            </div>
            <Button type="submit" variant="outline" size="sm" className="h-9">
              적용
            </Button>
          </form>
          {hexError && (
            <p id="pm-hex-error" role="alert" className="-mt-1 text-xs text-destructive">
              {hexError}
            </p>
          )}
          <button
            type="button"
            onClick={resetAccent}
            disabled={!override}
            className="inline-flex items-center gap-1.5 self-start text-[13px] text-muted-text underline-offset-4 pointer-coarse:min-h-11 hover:text-text hover:underline disabled:pointer-events-none disabled:opacity-40"
          >
            <RotateCcw className="size-3.5" aria-hidden="true" />
            프로젝트 기본값으로
          </button>
        </section>

        <div className="p-2">
          <a
            href="/projects/new"
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-text pointer-coarse:min-h-11 transition-colors hover:bg-sunken hover:text-text"
          >
            <Plus className="size-4" aria-hidden="true" />
            새 프로젝트 만들기
          </a>
          <button
            type="button"
            onClick={signOut}
            className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm text-muted-text transition-colors hover:bg-sunken hover:text-text"
          >
            <LogOut className="size-4" aria-hidden="true" />
            로그아웃
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
