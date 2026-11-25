import type { AgentRole } from "@/lib/db/schema/ai";
import type { AiProvider } from "@/lib/db/schema/projects";

export type { AgentRole };

/**
 * 제공자별 소형/중형 모델 ID. 모델 ID는 이 파일에만 둔다.
 * 출처: 설치된 패키지의 모델 ID 타입 정의(2026-11-25 기준).
 *  - @ai-sdk/anthropic 4.0.108: claude-haiku-5-5, claude-sonnet-5-5
 *  - @ai-sdk/openai 4.0.123: gpt-5.4-mini, gpt-5.5
 *  - @ai-sdk/google 4.0.126: gemini-3.5-flash-lite, gemini-3.5-flash
 * 1차 모델 급은 고정: 해소 검사(resolver) = small, 나머지 = mid.
 */
export const MODEL_DEFAULTS: Record<AiProvider, { small: string; mid: string }> = {
  anthropic: { small: "claude-haiku-5-5", mid: "claude-sonnet-5-5" },
  openai: { small: "gpt-5.4-mini", mid: "gpt-5.5" },
  google: { small: "gemini-3.5-flash-lite", mid: "gemini-3.5-flash" },
};

/** `"<provider>:<model>"` 형식의 기본 모델 ID. */
export function defaultModelFor(provider: AiProvider, role: AgentRole): string {
  const tier = role === "resolver" ? "small" : "mid";
  return `${provider}:${MODEL_DEFAULTS[provider][tier]}`;
}
