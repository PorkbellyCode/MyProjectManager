import type { CSSProperties } from "react";

/**
 * 움직임 값(docs/design/design-rules.md 7). 실제 애니메이션은 globals.css의 `.rise`·`.status-dot`이 하고,
 * 여기서는 그 값과 시차(stagger) 계산을 한 곳에 둔다. prefers-reduced-motion이면 CSS가 전부 끈다.
 */
export const EASE_OUT = "cubic-bezier(.2,.8,.2,1)";

/** 블록 등장: 0.5초, 6px 위로. 상세 화면은 본문 → AI 카드 → 활동 순으로 0.08초씩. */
export const fadeUp = {
  duration: 0.5,
  distance: 6,
  ease: EASE_OUT,
  step: 0.08,
} as const;

/** 상태 배지의 색 점이 바뀌는 시간. */
export const statusChange = { duration: 0.3, ease: "ease" } as const;

/** 목록 항목 i번째의 등장 지연. 12개를 넘으면 더 늦추지 않는다(긴 목록이 늦게 뜨지 않게). */
export function listStagger(index: number, step: number = fadeUp.step, max = 12): CSSProperties {
  return { animationDelay: `${(Math.min(index, max) * step).toFixed(2)}s` };
}

/** `.rise` 클래스와 함께 쓰는 단일 블록 지연. */
export function fadeUpDelay(order: number): CSSProperties {
  return listStagger(order, fadeUp.step, 4);
}
