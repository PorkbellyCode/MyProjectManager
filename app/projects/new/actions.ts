"use server";

import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { createProject, ProjectRuleError } from "@/lib/projects/service";
import { kickJobs } from "@/lib/jobs/queue";
import { newProjectSchema } from "@/app/p/[projectId]/admin/schemas";

export type CreateProjectResult = { ok: true; projectId: string } | { ok: false; error: string };

/** 로그인한 사람이면 누구나 새 프로젝트를 만들 수 있다(만든 사람이 리드). 만든 뒤 레포 분석을 바로 시작한다. */
export async function createProjectAction(input: unknown): Promise<CreateProjectResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "로그인이 필요해요." };
  const r = newProjectSchema.safeParse(input);
  if (!r.success) return { ok: false, error: r.error.issues[0]?.message ?? "입력 값이 올바르지 않아요." };
  try {
    const p = await createProject(db, {
      name: r.data.name,
      repoUrl: r.data.repoUrl,
      githubToken: r.data.githubToken || null,
      creatorId: user.id,
      defaultProvider: r.data.defaultProvider,
    });
    kickJobs();
    return { ok: true, projectId: p.id };
  } catch (e) {
    if (e instanceof ProjectRuleError) return { ok: false, error: e.message };
    console.error("[projects/new]", e);
    return { ok: false, error: "프로젝트를 만들지 못했어요. 잠시 뒤에 다시 시도해 주세요." };
  }
}
