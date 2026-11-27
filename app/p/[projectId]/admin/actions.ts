"use server";

import { eq } from "drizzle-orm";
import { refresh } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { groups, repoSnapshots } from "@/lib/db/schema";
import { getSessionUser } from "@/lib/auth";
import { ForbiddenError, getMembership, requireMember } from "@/lib/access";
import { getActiveProfile, saveProfileVersion } from "@/lib/agents/profiles";
import { updateOverviewTags } from "@/lib/agents/repo-analyst";
import { deleteGroup, setGroupMembers, updateGroup, upsertGroup } from "@/lib/groups/service";
import { InvalidTargetError } from "@/lib/tickets/targets";
import { isUuid } from "@/lib/tickets/detail";
import { kickJobs } from "@/lib/jobs/queue";
import {
  cancelInvitation,
  changeMemberRole,
  deleteDomainDoc,
  inviteMember,
  ProjectRuleError,
  removeMember,
  requestReanalysis,
  setAccentDefault,
  setDefaultProvider,
  setGithubToken,
  upsertDomainDoc,
} from "@/lib/projects/service";
import {
  cancelInviteSchema,
  changeRoleSchema,
  createGroupSchema,
  deleteDocSchema,
  deleteGroupSchema,
  inviteSchema,
  removeMemberSchema,
  saveProfileSchema,
  setAccentSchema,
  setGroupMembersSchema,
  setProviderSchema,
  setTokenSchema,
  updateGroupSchema,
  updateTagsSchema,
  upsertDocSchema,
  type ActionResult,
} from "./schemas";

/**
 * 관리자(리드 전용) 서버 액션. 모두 세션 → 멤버십 → 리드 확인(requireMember)을 거치고, 입력은 zod로 검사한다.
 * 비멤버는 not_found(404와 같게), 리드가 아니면 forbidden.
 */

class InputError extends Error {}

function fail(err: unknown): ActionResult & { ok: false } {
  if (err instanceof ForbiddenError) return { ok: false, code: "forbidden", error: err.message };
  if (err instanceof NotMember) return { ok: false, code: "not_found", error: "프로젝트를 찾을 수 없어요." };
  if (err instanceof ProjectRuleError || err instanceof InvalidTargetError || err instanceof InputError) {
    return { ok: false, code: "invalid", error: err.message };
  }
  if ((err as { code?: string; cause?: { code?: string } })?.code === "23505") {
    return { ok: false, code: "invalid", error: "같은 이름이 이미 있어요." };
  }
  console.error("[admin/actions]", err);
  return { ok: false, code: "error", error: "처리하지 못했어요. 잠시 뒤에 다시 시도해 주세요." };
}

class NotMember extends Error {}

function parse<T>(schema: z.ZodType<T>, input: unknown): T {
  const r = schema.safeParse(input);
  if (!r.success) throw new InputError(r.error.issues[0]?.message ?? "입력 값이 올바르지 않아요.");
  return r.data;
}

async function leadFor(projectId: string): Promise<{ userId: string }> {
  const u = await getSessionUser();
  if (!u) throw new ForbiddenError("로그인이 필요해요.");
  if (!isUuid(projectId) || !(await getMembership(db, projectId, u.id))) throw new NotMember();
  await requireMember(db, projectId, u.id, ["lead"]);
  return { userId: u.id };
}

async function run(projectId: string, fn: (lead: { userId: string }) => Promise<unknown>): Promise<ActionResult> {
  try {
    await fn(await leadFor(projectId));
  } catch (e) {
    return fail(e);
  }
  refresh();
  return { ok: true };
}

async function groupIn(projectId: string, groupId: string) {
  const [g] = await db.select({ id: groups.id, projectId: groups.projectId }).from(groups).where(eq(groups.id, groupId));
  if (!g || g.projectId !== projectId) throw new InvalidTargetError("그룹을 찾을 수 없어요");
}

// ---------- 멤버·초대 ----------
export async function inviteMemberAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const d = parse(inviteSchema, input);
    await inviteMember(db, { projectId, email: d.email, role: d.role, inviterId: lead.userId });
  });
}

export async function cancelInvitationAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    await cancelInvitation(db, projectId, parse(cancelInviteSchema, input).invitationId);
  });
}

export async function changeMemberRoleAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const d = parse(changeRoleSchema, input);
    if (d.userId === lead.userId) throw new InputError("내 역할은 다른 리드가 바꿀 수 있어요.");
    await changeMemberRole(db, { projectId, userId: d.userId, role: d.role });
  });
}

export async function removeMemberAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const userId = parse(removeMemberSchema, input).userId;
    if (userId === lead.userId) throw new InputError("나를 프로젝트에서 제외할 수는 없어요.");
    await removeMember(db, { projectId, userId });
  });
}

// ---------- 그룹 ----------
export async function createGroupAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    const d = parse(createGroupSchema, input);
    await upsertGroup(db, { projectId, name: d.name, scopeDescription: d.scopeDescription, repoTags: d.repoTags });
  });
}

export async function updateGroupAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    const d = parse(updateGroupSchema, input);
    await groupIn(projectId, d.groupId);
    await updateGroup(db, { projectId, groupId: d.groupId, name: d.name, scopeDescription: d.scopeDescription, repoTags: d.repoTags });
  });
}

export async function deleteGroupAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const d = parse(deleteGroupSchema, input);
    await groupIn(projectId, d.groupId);
    await deleteGroup(db, d.groupId, lead.userId);
  });
}

export async function setGroupMembersAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    const d = parse(setGroupMembersSchema, input);
    await groupIn(projectId, d.groupId);
    await setGroupMembers(db, d.groupId, d.userIds);
  });
}

// ---------- 설정 ----------
export async function setDefaultProviderAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    await setDefaultProvider(db, projectId, parse(setProviderSchema, input).provider);
  });
}

export async function setAccentDefaultAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    await setAccentDefault(db, projectId, parse(setAccentSchema, input).hex);
  });
}

/** 토큰은 저장만 하고 돌려주지 않는다. null이면 지운다. */
export async function setGithubTokenAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    await setGithubToken(db, projectId, parse(setTokenSchema, input).token);
  });
}

// ---------- 도메인 지식·에이전트 ----------
export async function upsertDomainDocAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const d = parse(upsertDocSchema, input);
    await upsertDomainDoc(db, { projectId, title: d.title, body: d.body, editorId: lead.userId });
  });
}

export async function deleteDomainDocAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    await deleteDomainDoc(db, projectId, parse(deleteDocSchema, input).docId);
  });
}

/** 지시사항만 새 버전으로 저장한다. 모델·도구·단계 수는 1차에서 읽기 전용이라 현재 값을 그대로 잇는다. */
export async function saveAgentProfileAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async (lead) => {
    const d = parse(saveProfileSchema, input);
    const cur = await getActiveProfile(db, projectId, d.role);
    await saveProfileVersion(db, {
      projectId,
      role: d.role,
      instructions: d.instructions,
      toolNames: cur.toolNames,
      modelId: cur.modelId,
      maxSteps: cur.maxSteps,
      editorId: lead.userId,
    });
  });
}

// ---------- 레포 ----------
export async function reanalyzeRepoAction(projectId: string): Promise<ActionResult> {
  const res = await run(projectId, async () => {
    await requestReanalysis(db, projectId);
  });
  if (res.ok) kickJobs();
  return res;
}

/** 모듈·화면·API 한 항목의 그룹 태그를 바꾼다. 스냅샷은 이 프로젝트의 것이어야 하고, 그룹은 서비스가 다시 검사한다. */
export async function updateOverviewTagsAction(projectId: string, input: unknown): Promise<ActionResult> {
  return run(projectId, async () => {
    const d = parse(updateTagsSchema, input);
    const [snap] = await db.select({ projectId: repoSnapshots.projectId }).from(repoSnapshots).where(eq(repoSnapshots.id, d.snapshotId));
    if (!snap || snap.projectId !== projectId) throw new InputError("분석 결과를 찾을 수 없어요.");
    try {
      await updateOverviewTags(db, d.snapshotId, { [d.kind]: { [d.path]: d.groupId } });
    } catch (e) {
      if (e instanceof Error && !(e instanceof ProjectRuleError)) throw new InputError(e.message);
      throw e;
    }
  });
}
