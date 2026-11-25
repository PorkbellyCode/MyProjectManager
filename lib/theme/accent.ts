import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { projects, userPreferences, type AiProvider } from "@/lib/db/schema";

/**
 * AI 제공자 팔레트(docs/design/design-rules.md 3.1, 4).
 * accent/accentDark = 강조색(라이트/다크), tint·ring = 라이트 기준 AI 표시 바탕·테두리.
 */
export type ProviderPalette = { accent: string; accentDark: string; tint: string; ring: string };

const PALETTE: Record<AiProvider, ProviderPalette> = {
  anthropic: { accent: "#C2410C", accentDark: "#EF7D3C", tint: "#FBEFE9", ring: "#F1CDBD" },
  openai: { accent: "#0F766E", accentDark: "#2DD4BF", tint: "#E7F6F0", ring: "#B5E2D2" },
  google: { accent: "#1D4ED8", accentDark: "#6FA3FF", tint: "#EEF3FE", ring: "#C7D6FB" },
};

export const AI_PROVIDERS = Object.keys(PALETTE) as AiProvider[];

export function providerPalette(provider: AiProvider): ProviderPalette {
  return { ...PALETTE[provider] };
}

/** AI 표시(✦)에 쓰는 전체 값: 라이트/다크의 tint, ring, 글자색(4절 표). */
export type ProviderAiTokens = {
  name: string;
  light: { tint: string; ring: string; text: string };
  dark: { tint: string; ring: string; text: string };
};

const AI_TOKENS: Record<AiProvider, ProviderAiTokens> = {
  anthropic: {
    name: "Claude",
    light: { tint: "#FBEFE9", ring: "#F1CDBD", text: "#97401F" },
    dark: { tint: "#2A1B15", ring: "#5A3324", text: "#F2A98A" },
  },
  openai: {
    name: "ChatGPT",
    light: { tint: "#E7F6F0", ring: "#B5E2D2", text: "#0A6650" },
    dark: { tint: "#0F2620", ring: "#1F5546", text: "#62D6B3" },
  },
  google: {
    name: "Gemini",
    light: { tint: "#EEF3FE", ring: "#C7D6FB", text: "#1E40AF" },
    dark: { tint: "#121B2E", ring: "#23365E", text: "#8DB4FF" },
  },
};

export function providerAiTokens(provider: AiProvider): ProviderAiTokens {
  return AI_TOKENS[provider];
}

/** 프로필 메뉴의 프리셋(제공자 순서 = 화면 순서). */
export const ACCENT_PRESETS: { provider: AiProvider; label: string; accent: string }[] = [
  { provider: "anthropic", label: "Claude 주황", accent: PALETTE.anthropic.accent },
  { provider: "openai", label: "ChatGPT 옥색", accent: PALETTE.openai.accent },
  { provider: "google", label: "Gemini 파랑", accent: PALETTE.google.accent },
];

export const HEX_RE = /^#[0-9a-fA-F]{6}$/;

export function normalizeHex(value: string): string | null {
  const v = value.trim();
  return HEX_RE.test(v) ? v.toUpperCase() : null;
}

/** 프리셋 라이트 색이면 짝이 되는 다크 값을 쓰고, 직접 고른 색은 두 테마에서 그대로 쓴다. */
export function accentPair(hex: string): { light: string; dark: string } {
  const h = hex.toUpperCase();
  const hit = AI_PROVIDERS.find((p) => PALETTE[p].accent === h);
  return { light: h, dark: hit ? PALETTE[hit].accentDark : h };
}

function luminance(hex: string): number {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((c) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

/** 강조색 위에 올리는 글자색. 어두운 바탕엔 흰색, 밝은 바탕엔 거의 검정 중 대비가 큰 쪽. */
export function onAccent(hex: string): string {
  const dark = "#140B05";
  return contrastRatio(hex, "#FFFFFF") >= contrastRatio(hex, dark) ? "#FFFFFF" : dark;
}

/** 사용자 accentOverride → 프로젝트 accentDefault → 프로젝트 기본 제공자 색(라이트 값). */
export function pickAccent(input: {
  override: string | null | undefined;
  projectDefault: string | null | undefined;
  provider: AiProvider;
}): string {
  // 데이터에서 온 값은 #RRGGBB가 아니면 버린다(화면 스타일에 그대로 들어가므로).
  return (
    normalizeHex(input.override ?? "") ??
    normalizeHex(input.projectDefault ?? "") ??
    providerPalette(input.provider).accent
  );
}

/** 프로젝트 화면의 강조색(라이트 값). 프로젝트가 없으면 null. */
export async function getProjectAccent(db: Db, projectId: string, userId: string): Promise<string | null> {
  const [row] = await db
    .select({
      override: userPreferences.accentOverride,
      projectDefault: projects.accentDefault,
      provider: projects.defaultProvider,
    })
    .from(projects)
    .leftJoin(userPreferences, eq(userPreferences.userId, userId))
    .where(eq(projects.id, projectId))
    .limit(1);
  return row ? pickAccent(row) : null;
}

/** 셸이 CSS 변수로 쓰는 값: 라이트/다크 강조색과 그 위의 글자색. */
export function resolveAccentVars(accentLight: string) {
  const pair = accentPair(accentLight);
  return {
    light: pair.light,
    dark: pair.dark,
    onLight: onAccent(pair.light),
    onDark: onAccent(pair.dark),
  };
}

const SAFE_HEX = /^#[0-9A-F]{6}$/;

/**
 * 셸이 <style>로 내보내는 html:root 변수 블록. 값은 #RRGGBB(대문자)로 검증된 것만 쓰고,
 * 아니면 제공자 색으로 바꾼다. 어떤 입력이 와도 `<`나 `;` 같은 문자는 나오지 않는다.
 */
export function accentStyleText(accent: string, provider: AiProvider): string {
  const safe = (v: string, fallback: string) => (SAFE_HEX.test(v) ? v : fallback);
  const fallback = providerPalette(provider).accent;
  const a = accentPair(safe(normalizeHex(accent) ?? "", fallback));
  const ai = providerAiTokens(provider);
  const decl: [string, string][] = [
    ["--accent-l", a.light],
    ["--accent-d", a.dark],
    ["--on-accent-l", onAccent(a.light)],
    ["--on-accent-d", onAccent(a.dark)],
    ["--ai-tint-l", ai.light.tint],
    ["--ai-tint-d", ai.dark.tint],
    ["--ai-ring-l", ai.light.ring],
    ["--ai-ring-d", ai.dark.ring],
    ["--ai-text-l", ai.light.text],
    ["--ai-text-d", ai.dark.text],
  ];
  return `html:root{${decl.filter(([, v]) => SAFE_HEX.test(v)).map(([k, v]) => `${k}:${v}`).join(";")}}`;
}
