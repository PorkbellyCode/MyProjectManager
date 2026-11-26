"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import type { ActionResult } from "@/app/p/[projectId]/tickets/schemas";

/**
 * 서버 액션 실행 + 실패 안내. 충돌(다른 곳에서 바뀜)이면 안내하고 화면을 새로 고친다.
 * 성공 시 화면 갱신은 액션의 refresh()가 같은 응답에서 한다.
 */
export function useTicketAction() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function execute(fn: () => Promise<ActionResult>, opts: { onSuccess?: () => void; success?: string } = {}) {
    setError(null);
    return new Promise<boolean>((resolve) => {
      startTransition(async () => {
        let res: ActionResult;
        try {
          res = await fn();
        } catch {
          res = { ok: false, code: "error", error: "연결이 끊겼어요. 잠시 뒤에 다시 시도해 주세요." };
        }
        if (res.ok) {
          if (opts.success) toast.success(opts.success);
          opts.onSuccess?.();
          resolve(true);
          return;
        }
        if (res.code === "conflict") {
          toast.info(res.error);
          router.refresh();
        } else {
          setError(res.error);
          toast.error(res.error);
        }
        resolve(false);
      });
    });
  }

  return { execute, pending, error, setError };
}
