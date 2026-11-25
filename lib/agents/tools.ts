import { asc, eq, inArray } from "drizzle-orm";
import { tool, type Tool } from "ai";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { domainDocs, groupMembers, groups, user } from "@/lib/db/schema";
import { getLatestSnapshot } from "@/lib/agents/repo-analyst";
import { searchSimilarTickets } from "@/lib/tickets/search";

export type ToolContext = { db: Db; projectId: string; ticketId: string | null };
export type ToolName = "searchTickets" | "getDomainDocs" | "listRecentChanges" | "getRepoOverview" | "getGroups";

export function buildTools(ctx: ToolContext): Record<ToolName, Tool> {
  const { db, projectId, ticketId } = ctx;
  return {
    searchTickets: tool({
      description:
        "이 프로젝트의 제출된 티켓을 키워드로 검색한다. 초안과 철회된 티켓은 나오지 않는다. 결과의 id를 `ticket:<id>` 근거로 쓸 수 있다.",
      inputSchema: z.object({
        query: z.string().describe("검색어"),
        limit: z.number().int().min(1).max(10).optional(),
      }),
      execute: async ({ query, limit }) => searchSimilarTickets(db, projectId, query, ticketId ?? undefined, limit ?? 5),
    }),

    getDomainDocs: tool({
      description: "이 프로젝트의 도메인 지식 문서 전체를 돌려준다. 문서 id를 `doc:<id>` 근거로 쓸 수 있다.",
      inputSchema: z.object({}),
      execute: async () =>
        db
          .select({ id: domainDocs.id, title: domainDocs.title, body: domainDocs.body })
          .from(domainDocs)
          .where(eq(domainDocs.projectId, projectId))
          .orderBy(asc(domainDocs.title)),
    }),

    listRecentChanges: tool({
      description:
        "레포의 최근 커밋과 PR을 돌려준다. 커밋 sha는 `commit:<sha>`, PR 번호는 `pr:<number>` 근거로 쓸 수 있다. 레포 정보가 없으면 available:false.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await getLatestSnapshot(db, projectId, { status: "ok" });
        if (!snap?.facts) return { available: false as const };
        return { available: true as const, commits: snap.facts.commits, pulls: snap.facts.pulls };
      },
    }),

    getRepoOverview: tool({
      description: "레포의 기술 스택, 모듈, 화면, API, 도메인 개요를 돌려준다. 레포 정보가 없으면 available:false.",
      inputSchema: z.object({}),
      execute: async () => {
        const snap = await getLatestSnapshot(db, projectId, { status: "ok" });
        if (!snap?.overview) return { available: false as const };
        return { available: true as const, overview: snap.overview };
      },
    }),

    getGroups: tool({
      description: "이 프로젝트의 그룹 목록과 담당 범위, 연결된 레포 경로, 그룹원 이름을 돌려준다.",
      inputSchema: z.object({}),
      execute: async () => {
        const gs = await db.select().from(groups).where(eq(groups.projectId, projectId)).orderBy(asc(groups.name));
        if (gs.length === 0) return [];
        const members = await db
          .select({ groupId: groupMembers.groupId, name: user.name })
          .from(groupMembers)
          .innerJoin(user, eq(user.id, groupMembers.userId))
          .where(
            inArray(
              groupMembers.groupId,
              gs.map((g) => g.id),
            ),
          )
          .orderBy(asc(user.name));
        const snap = await getLatestSnapshot(db, projectId, { status: "ok" });
        const ov = snap?.overview;
        const tagged = ov ? [...ov.modules, ...ov.screens, ...ov.apis] : [];
        return gs.map((g) => ({
          groupId: g.id,
          name: g.name,
          scopeDescription: g.scopeDescription,
          repoTags: tagged.filter((x) => x.groupId === g.id).map((x) => x.path),
          memberNames: members.filter((m) => m.groupId === g.id).map((m) => m.name),
        }));
      },
    }),
  };
}
