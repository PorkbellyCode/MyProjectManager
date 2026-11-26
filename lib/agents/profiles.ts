import { and, desc, eq } from "drizzle-orm";
import type { Db } from "@/lib/db";
import { agentProfileVersions, projects, user, type AgentRole } from "@/lib/db/schema";
import { defaultModelFor } from "@/lib/ai/models";
import { DEFAULT_MAX_STEPS, DEFAULT_TOOL_NAMES, defaultInstructionsFor } from "./defaults";

export type { AgentRole };
export const AGENT_ROLES: AgentRole[] = ["resolver", "lead", "recommender", "summarizer", "repo"];

export type AgentProfile = {
  versionId: string;
  version: number;
  instructions: string;
  toolNames: string[];
  modelId: string;
  maxSteps: number;
};

export type SaveProfileInput = {
  projectId: string;
  role: AgentRole;
  instructions: string;
  toolNames: string[];
  modelId: string;
  maxSteps: number;
  editorId: string;
};

function toProfile(row: typeof agentProfileVersions.$inferSelect): AgentProfile {
  return {
    versionId: row.id,
    version: row.version,
    instructions: row.instructions,
    toolNames: row.toolNames,
    modelId: row.modelId,
    maxSteps: row.maxSteps,
  };
}

/** 가장 높은 version이 활성이다. */
export async function getActiveProfile(db: Db, projectId: string, role: AgentRole): Promise<AgentProfile> {
  const [row] = await db
    .select()
    .from(agentProfileVersions)
    .where(and(eq(agentProfileVersions.projectId, projectId), eq(agentProfileVersions.role, role)))
    .orderBy(desc(agentProfileVersions.version))
    .limit(1);
  if (!row) throw new Error(`에이전트 프로필이 없어요: ${role}`);
  return toProfile(row);
}

/** 항상 새 행(다음 version)을 만든다. 동시에 저장하면 unique 제약 위반 시 한 번 더 시도한다. */
export async function saveProfileVersion(db: Db, input: SaveProfileInput): Promise<AgentProfile> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.transaction(async (tx) => {
        const [latest] = await tx
          .select({ version: agentProfileVersions.version })
          .from(agentProfileVersions)
          .where(and(eq(agentProfileVersions.projectId, input.projectId), eq(agentProfileVersions.role, input.role)))
          .orderBy(desc(agentProfileVersions.version))
          .limit(1);
        const [row] = await tx
          .insert(agentProfileVersions)
          .values({
            projectId: input.projectId,
            role: input.role,
            version: (latest?.version ?? 0) + 1,
            instructions: input.instructions,
            toolNames: input.toolNames,
            modelId: input.modelId,
            maxSteps: input.maxSteps,
            createdBy: input.editorId,
          })
          .returning();
        return toProfile(row);
      });
    } catch (err) {
      if (attempt >= 2 || !isUniqueViolation(err)) throw err;
    }
  }
}

function isUniqueViolation(err: unknown): boolean {
  const code = (err as { code?: string; cause?: { code?: string } })?.code ?? (err as { cause?: { code?: string } })?.cause?.code;
  return code === "23505";
}

/** 역할별 v1이 없는 것만 채운다. 이미 있는 역할은 건드리지 않는다. */
export async function ensureDefaultProfiles(db: Db, projectId: string, editorId: string): Promise<void> {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId));
  if (!project) throw new Error("프로젝트를 찾을 수 없어요.");
  const existing = await db
    .select({ role: agentProfileVersions.role })
    .from(agentProfileVersions)
    .where(eq(agentProfileVersions.projectId, projectId));
  const have = new Set(existing.map((r) => r.role));
  for (const role of AGENT_ROLES) {
    if (have.has(role)) continue;
    await saveProfileVersion(db, {
      projectId,
      role,
      instructions: defaultInstructionsFor(role),
      toolNames: DEFAULT_TOOL_NAMES[role],
      modelId: defaultModelFor(project.defaultProvider, role),
      maxSteps: DEFAULT_MAX_STEPS,
      editorId,
    });
  }
}

export type ProfileVersionRow = { id: string; version: number; instructions: string; createdAt: Date; editorName: string | null };

/** 역할별 버전 목록(최신이 위). 편집자 이름은 사용자가 지워졌으면 null. */
export async function listProfileVersions(db: Db, projectId: string, role: AgentRole): Promise<ProfileVersionRow[]> {
  const rows = await db
    .select({
      id: agentProfileVersions.id,
      version: agentProfileVersions.version,
      instructions: agentProfileVersions.instructions,
      createdAt: agentProfileVersions.createdAt,
      editorName: user.name,
    })
    .from(agentProfileVersions)
    .leftJoin(user, eq(user.id, agentProfileVersions.createdBy))
    .where(and(eq(agentProfileVersions.projectId, projectId), eq(agentProfileVersions.role, role)))
    .orderBy(desc(agentProfileVersions.version));
  return rows;
}
