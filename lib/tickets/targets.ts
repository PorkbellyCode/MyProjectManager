import { and, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { groups } from "@/lib/db/schema";
import { getMembership } from "@/lib/access";

/** 담당 대상. `null`은 리드 큐. */
export type Target = { kind: "user"; userId: string } | { kind: "group"; groupId: string } | null;

export class InvalidTargetError extends Error {
  constructor(message = "대상이 이 프로젝트에 없어요") {
    super(message);
    this.name = "InvalidTargetError";
  }
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * 대상이 이 프로젝트의 것인지 확인한다.
 * - 사람: 프로젝트 멤버여야 하고 요청자 역할이면 안 된다.
 * - 그룹: 이 프로젝트의 그룹이어야 한다.
 * - null(리드 큐): 그대로 통과.
 */
export async function validateTarget(db: Db, projectId: string, target: Target): Promise<Target> {
  if (target === null) return null;
  if (target.kind === "user") {
    const m = await getMembership(db, projectId, target.userId);
    if (!m || m.role === "requester") throw new InvalidTargetError();
    return target;
  }
  if (!UUID_RE.test(target.groupId)) throw new InvalidTargetError();
  const [g] = await db
    .select({ id: groups.id })
    .from(groups)
    .where(and(eq(groups.id, target.groupId), eq(groups.projectId, projectId)))
    .limit(1);
  if (!g) throw new InvalidTargetError();
  return target;
}
