"use client";

import { useSyncExternalStore } from "react";
import type { ThemePreference } from "@/lib/db/schema";
import { THEME_COOKIE } from "@/lib/theme/constants";

export type ResolvedTheme = "light" | "dark";

function subscribe(cb: () => void) {
  const mo = new MutationObserver(cb);
  mo.observe(document.documentElement, { attributes: true, attributeFilter: ["data-theme"] });
  return () => mo.disconnect();
}

/** html의 data-theme(첫 페인트 전 스크립트와 서버가 정함)을 따라간다. */
export function useResolvedTheme(): ResolvedTheme {
  return useSyncExternalStore(
    subscribe,
    () => (document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light"),
    () => "light",
  );
}

export function resolveTheme(pref: ThemePreference): ResolvedTheme {
  if (pref === "system") return matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  return pref;
}

/** 설정을 즉시 화면에 반영한다(서버 저장은 별도). 셸 래퍼는 system일 때만 html을 따르도록 속성을 뗀다. */
export function applyTheme(pref: ThemePreference): void {
  const root = document.documentElement;
  const next = resolveTheme(pref);
  const shell = document.querySelector<HTMLElement>("[data-shell]");
  root.classList.add("theme-transition");
  root.setAttribute("data-theme", next);
  if (shell) {
    if (pref === "system") shell.removeAttribute("data-theme");
    else shell.setAttribute("data-theme", pref);
  }
  document.cookie = `${THEME_COOKIE}=${pref}; path=/; max-age=31536000; samesite=lax`;
  window.setTimeout(() => root.classList.remove("theme-transition"), 400);
}

const ACCENT_KEYS = ["--accent-l", "--accent-d", "--on-accent-l", "--on-accent-d"];

/** 강조색을 즉시 화면에 반영한다. 포털까지 닿도록 html에 직접 건다. */
export function applyAccentVars(vars: Record<string, string>): void {
  for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
}

/** 즉시 반영한 값을 걷어내 서버가 보낸 값(<style id="mpm-accent">)이 다시 적용되게 한다. */
export function clearAccentVars(): void {
  for (const k of ACCENT_KEYS) document.documentElement.style.removeProperty(k);
}
