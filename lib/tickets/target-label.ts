import type { TargetOptions } from "./detail";
import type { Target } from "./targets";

/** 담당 대상의 표시 이름(서버·클라이언트 공용, DB 접근 없음). */
export function describeTarget(t: Target, options: TargetOptions): { label: string; kind: "lead" | "group" | "user" } {
  if (t === null) return { label: "비워 두기(리드에게)", kind: "lead" };
  if (t.kind === "group") return { label: options.groups.find((g) => g.id === t.groupId)?.name ?? "삭제된 그룹", kind: "group" };
  return { label: options.people.find((p) => p.id === t.userId)?.name ?? "프로젝트에 없는 사람", kind: "user" };
}
