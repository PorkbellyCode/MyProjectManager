"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Bell } from "lucide-react";
import { toast } from "sonner";

const POLL_MS = 30_000;

/** 알림 아이콘과 읽지 않은 수. 30초마다 서버에서 다시 가져온다(탭이 가려져 있으면 쉰다). */
export function NotificationBadge({ initial }: { initial: number }) {
  const [count, setCount] = useState(initial);
  const router = useRouter();
  const last = useRef(initial);

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
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stopped = true;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
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
