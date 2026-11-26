"use client";

import { updateOverviewTagsAction } from "@/app/p/[projectId]/admin/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";

/** 리드만 쓰는 그룹 태그 고르기. 고르면 바로 저장한다. */
export function TagSelect({
  projectId,
  snapshotId,
  kind,
  path,
  value,
  groups,
}: {
  projectId: string;
  snapshotId: string;
  kind: "modules" | "screens" | "apis";
  path: string;
  value: string | null;
  groups: { id: string; name: string }[];
}) {
  const { execute, pending } = useTicketAction();
  return (
    <select
      aria-label={`${path} 그룹 태그`}
      value={value ?? ""}
      disabled={pending}
      onChange={(e) =>
        void execute(() => updateOverviewTagsAction(projectId, { snapshotId, kind, path, groupId: e.target.value || null }), {
          success: "태그를 바꿨어요.",
        })
      }
      className="h-8 rounded-lg border border-line bg-surface px-2 text-sm outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40"
    >
      <option value="">태그 없음</option>
      {groups.map((g) => (
        <option key={g.id} value={g.id}>
          {g.name}
        </option>
      ))}
    </select>
  );
}
