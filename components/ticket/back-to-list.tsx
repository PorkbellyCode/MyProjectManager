"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft } from "lucide-react";

const key = (projectId: string) => `mpm-list-query:${projectId}`;
const noop = () => () => {};

/** 목록 화면이 지금 탭·필터(쿼리 문자열)를 기억해 둔다. 상세에서 돌아갈 때 그대로 연다. */
export function RememberListQuery({ projectId }: { projectId: string }) {
  const search = useSearchParams().toString();
  useEffect(() => {
    try {
      sessionStorage.setItem(key(projectId), search);
    } catch {
      // 저장소를 못 쓰면 기본 목록으로 돌아간다.
    }
  }, [projectId, search]);
  return null;
}

/** 티켓 상세의 '목록으로' 링크. 마지막으로 본 목록의 탭·필터를 살린다. */
export function BackToList({ projectId }: { projectId: string }) {
  const query = useSyncExternalStore(
    noop,
    () => {
      try {
        return sessionStorage.getItem(key(projectId)) ?? "";
      } catch {
        return "";
      }
    },
    () => "",
  );
  const href = `/p/${projectId}/tickets${query ? `?${query}` : ""}`;
  return (
    <Link
      href={href}
      className="-ml-2 inline-flex w-fit items-center gap-1.5 rounded-lg px-2 py-1 text-[13px] text-muted-text transition-colors hover:bg-sunken hover:text-text pointer-coarse:min-h-11"
    >
      <ArrowLeft className="size-3.5" aria-hidden="true" />
      티켓 목록
    </Link>
  );
}
