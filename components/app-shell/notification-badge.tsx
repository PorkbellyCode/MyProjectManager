"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";
import { NOTIFICATIONS_CHANGED } from "@/lib/notifications/labels";

const POLL_MS = 30_000;

/**
 * 알림 아이콘과 읽지 않은 수. 30초마다 서버에서 다시 가져온다(탭이 가려져 있으면 쉰다).
 * 알림을 읽음 처리한 화면이 NOTIFICATIONS_CHANGED를 보내면 바로 다시 센다. 서버가 새 값을 내려도 따라간다.
 */
export function NotificationBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const [seen, setSeen] = useState(initial);
  const router = useRouter();
  const last = useRef(initial);
  if (seen !== initial) {
    // 서버 렌더가 새 개수를 내려보냈다(이동·새로 고침). 렌더 중 상태 맞추기(React 권장 패턴).
    setSeen(initial);
    setCount(initial);
  }

  useEffect(() => {
    last.current = initial;
  }, [initial]);

  useEffect(() => {
    let stopped = false;
    async function poll() {
      if (document.visibilityState === "hidden") return;
      try {
        const res = await fetch("/api/notifications/unread", { cache: "no-store" });
        if (!res.ok || stopped) return;
        const { count: next } = (await res.json()) as { count: number };
        if (next > last.current) {
          toast.info(`새 알림이 ${next - last.current}건 도착했어요`, {
            action: { label: "보기", onClick: () => router.push("/notifications") },
          });
        }
        last.current = next;
        setCount(next);
      } catch {
        // 네트워크가 잠깐 끊겨도 다음 주기에 다시 시도한다.
      }
    }
    const id = window.setInterval(poll, POLL_MS);
    const onVisible = () => document.visibilityState === "visible" && void poll();
    const onChanged = () => {
      // 내가 읽은 것이므로 줄어든 값을 그대로 받아들인다(새 알림 안내는 띄우지 않는다).
      last.current = Number.MAX_SAFE_INTEGER;
      void poll().finally(() => {
        if (last.current === Number.MAX_SAFE_INTEGER) last.current = 0;
      });
    };
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener(NOTIFICATIONS_CHANGED, onChanged);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChanged);
    };
  }, [router]);

  return (
    <Link
      href="/notifications"
      aria-label={count > 0 ? `알림 ${count}건` : "알림"}
      className="relative flex size-10 items-center justify-center rounded-lg border border-line text-text transition-[transform,background-color] duration-[120ms] hover:-translate-y-px hover:bg-sunken"
    >
      <Bell className="size-[18px]" aria-hidden="true" />
      {count > 0 && (
        <span
          aria-hidden="true"
          className="absolute -right-1.5 -top-1.5 flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-brand px-1 font-mono text-[11px] font-medium leading-none text-on-brand"
        >
          {count > 99 ? "99+" : count}
        </span>
      )}
    </Link>
  );
}
