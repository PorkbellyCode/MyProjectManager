import { cn } from "@/lib/utils";
import { providerAiTokens } from "@/lib/theme/accent";
import type { AiProvider } from "@/lib/db/schema";

const PROVIDERS = new Set(["anthropic", "openai", "google"]);

/** 제공자 이름. 모르는 제공자(또는 없음)면 null — 그때는 "✦ AI"만 보인다. */
export function providerName(provider: string | null | undefined): string | null {
  return provider && PROVIDERS.has(provider) ? providerAiTokens(provider as AiProvider).name : null;
}

/**
 * 그 판단을 실제로 만든 제공자의 AI 표시색(디자인 규칙 4). 제공자를 모르면 프로젝트 기본값(셸의 --ai-*)을 그대로 쓴다.
 * `.ai-scope`가 라이트/다크 값 중 하나를 고른다(globals.css).
 */
export function aiScopeStyle(provider: string | null | undefined): React.CSSProperties | undefined {
  if (!provider || !PROVIDERS.has(provider)) return undefined;
  const t = providerAiTokens(provider as AiProvider);
  return {
    "--ai-tint-l": t.light.tint,
    "--ai-ring-l": t.light.ring,
    "--ai-text-l": t.light.text,
    "--ai-tint-d": t.dark.tint,
    "--ai-ring-d": t.dark.ring,
    "--ai-text-d": t.dark.text,
  } as React.CSSProperties;
}

/** ✦ 반짝이 아이콘(디자인 시안의 도형). */
export function Sparkle({ className }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={cn("size-4 shrink-0", className)}>
      <path d="M12 2l2.2 6.6L21 11l-6.8 2.4L12 20l-2.2-6.6L3 11l6.8-2.4z" />
    </svg>
  );
}

/** "✦ Claude 검토" 같은 AI 이름표. */
export function AiLabel({ provider, suffix, className }: { provider: string | null | undefined; suffix?: string; className?: string }) {
  const name = providerName(provider) ?? "AI";
  return (
    <span className={cn("inline-flex items-center gap-1.5 text-sm font-semibold text-ai-text", className)}>
      <Sparkle />
      {name}
      {suffix ? ` ${suffix}` : ""}
    </span>
  );
}

/**
 * AI가 만든 카드의 틀: 연한 바탕 + 얇은 테두리 + ✦ 제공자 이름(진한 면·왼쪽 굵은 띠 없음).
 * `label`은 화면 읽기용 영역 이름(예: "중복 확인 결과").
 */
export function AiCard({
  provider,
  label,
  heading,
  meta,
  children,
  className,
  style,
}: {
  provider: string | null | undefined;
  label: string;
  heading?: string;
  meta?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  style?: React.CSSProperties;
}) {
  return (
    <section
      aria-label={label}
      className={cn("ai-scope rise flex flex-col gap-4 rounded-[14px] border border-ai-ring bg-ai-tint p-6", className)}
      style={{ ...aiScopeStyle(provider), ...style }}
    >
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <AiLabel provider={provider} suffix="검토" />
        {heading && (
          <span className="rounded-full bg-surface px-2.5 py-0.5 text-[13px] font-medium text-text">{heading}</span>
        )}
        {meta && <span className="ml-auto font-mono text-xs text-faint">{meta}</span>}
      </div>
      {children}
    </section>
  );
}
