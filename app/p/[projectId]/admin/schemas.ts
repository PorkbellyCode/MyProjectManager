import { z } from "zod";
import { HEX_RE } from "@/lib/theme/accent";

/** 관리자 액션의 입력 스키마. 서버 액션(검증)과 클라이언트 폼(react-hook-form)이 같이 쓴다. */

export type { ActionResult } from "@/app/p/[projectId]/tickets/schemas";

const id = z.string().min(1).max(100);
const uuid = z.string().uuid();

export const memberRoleSchema = z.enum(["requester", "lead", "developer"], { error: "역할을 골라 주세요." });
export const providerSchema = z.enum(["anthropic", "openai", "google"], { error: "AI 제공자를 골라 주세요." });

export const inviteSchema = z.object({
  email: z.string().trim().min(1, "이메일을 적어 주세요.").max(200).email("이메일 주소를 확인해 주세요."),
  role: memberRoleSchema,
});
export const cancelInviteSchema = z.object({ invitationId: id });
export const changeRoleSchema = z.object({ userId: id, role: memberRoleSchema });
export const removeMemberSchema = z.object({ userId: id });

export const GROUP_NAME_MAX = 40;
export const groupFormSchema = z.object({
  name: z.string().trim().min(1, "그룹 이름을 적어 주세요.").max(GROUP_NAME_MAX, `이름은 ${GROUP_NAME_MAX}자 이하로 적어 주세요.`),
  scopeDescription: z.string().trim().max(300, "담당 범위는 300자 이하로 적어 주세요."),
  /** 쉼표로 구분한 레포 태그 */
  repoTags: z.string().max(300, "태그가 너무 길어요."),
});
export type GroupFormValues = z.infer<typeof groupFormSchema>;
export const parseTags = (s: string) => [...new Set(s.split(",").map((t) => t.trim()).filter(Boolean))].slice(0, 20);

export const createGroupSchema = groupFormSchema.transform((v) => ({ ...v, repoTags: parseTags(v.repoTags) }));
export const updateGroupSchema = groupFormSchema
  .extend({ groupId: uuid })
  .transform((v) => ({ ...v, repoTags: parseTags(v.repoTags) }));
export const deleteGroupSchema = z.object({ groupId: uuid });
export const setGroupMembersSchema = z.object({ groupId: uuid, userIds: z.array(id).max(200) });

export const setProviderSchema = z.object({ provider: providerSchema });
export const accentFormSchema = z.object({
  hex: z.string().trim().regex(HEX_RE, "#RRGGBB 형식으로 입력해 주세요."),
});
export const setAccentSchema = z.object({ hex: z.string().max(40).nullable() });
export const setTokenSchema = z.object({ token: z.string().max(500).nullable() });

export const saveProfileSchema = z.object({
  role: z.enum(["resolver", "lead", "recommender", "summarizer", "repo"]),
  instructions: z.string().trim().min(1, "지시사항을 적어 주세요.").max(30_000, "지시사항이 너무 길어요."),
});

export const upsertDocSchema = z.object({
  title: z.string().trim().min(1, "제목을 적어 주세요.").max(80, "제목은 80자 이하로 적어 주세요."),
  body: z.string().max(50_000, "내용이 너무 길어요."),
});
export const deleteDocSchema = z.object({ docId: uuid });

export const updateTagsSchema = z.object({
  snapshotId: uuid,
  kind: z.enum(["modules", "screens", "apis"]),
  path: z.string().min(1).max(500),
  groupId: uuid.nullable(),
});

export const newProjectSchema = z.object({
  name: z.string().trim().min(1, "프로젝트 이름을 적어 주세요.").max(80, "이름은 80자 이하로 적어 주세요."),
  repoUrl: z.string().trim().min(1, "GitHub 주소를 적어 주세요.").max(300),
  githubToken: z.string().max(500).optional(),
  defaultProvider: providerSchema,
});
export type NewProjectValues = z.infer<typeof newProjectSchema>;
