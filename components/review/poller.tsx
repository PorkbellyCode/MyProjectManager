"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * 검토가 도는 동안 화면을 새로 고친다(실시간 연결 없이 1.5초 간격, 인터뷰 설계 3·4.3).
 * 탭이 가려져 있으면 쉬고, 돌아오면 바로 한 번 새로 고친다. `maxMs`가 지나면 멈춘다(작업이 멈춘 경우 무한 폴링 방지).
 */
export function Poller({ active, intervalMs = 1500, maxMs = 5 * 60_000 }: { active: boolean; intervalMs?: number; maxMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const tick = () => {
      if (document.visibilityState !== "visible") return;
      if (Date.now() - started > maxMs) return;
      router.refresh();
    };
    const id = window.setInterval(tick, intervalMs);
    const onVisible = () => document.visibilityState === "visible" && router.refresh();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [active, intervalMs, maxMs, router]);
  return null;
}
