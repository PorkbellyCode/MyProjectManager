import { forbidden, notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMembership } from "@/lib/access";
import { isUuid } from "@/lib/tickets/detail";

/**
 * 관리자 섹션 화면의 공통 입구. 비로그인은 /login, 비멤버는 404, 리드가 아니면 403("권한이 없어요").
 * 섹션마다 따로 부른다(레이아웃만 믿지 않는다: 레이아웃은 형제 화면으로 옮겨 갈 때 다시 돌지 않는다).
 */
export async function requireLeadPage(params: Promise<{ projectId: string }>): Promise<{ projectId: string; userId: string }> {
  const { projectId } = await params;
  const user = await getSessionUser();
  if (!user) redirect("/login");
  const membership = isUuid(projectId) ? await getMembership(db, projectId, user.id) : null;
  if (!membership) notFound();
  if (membership.role !== "lead") forbidden();
  return { projectId, userId: user.id };
}
