import { expect, test } from "vitest";
import { createTestDb } from "../helpers/db";
import { seedOrganization } from "../helpers/seed";
import { groups, projects } from "@/lib/db/schema";

const REPO = "https://github.com/PorkbellyCode/MyProjectManager-sample-repo";

test("프로젝트 기본값: 제공자 anthropic, isDemo false", async () => {
  const { db, close } = await createTestDb();
  try {
    const org = await seedOrganization(db, "Sample");
    const [p] = await db
      .insert(projects)
      .values({ organizationId: org.id, name: "Sample", repoUrl: REPO })
      .returning();
    expect(p.defaultProvider).toBe("anthropic");
    expect(p.isDemo).toBe(false);
    expect(p.githubTokenEnc).toBeNull();
  } finally {
    await close();
  }
});

test("같은 프로젝트에 같은 이름 그룹은 거부", async () => {
  const { db, close } = await createTestDb();
  try {
    const org = await seedOrganization(db, "Sample");
    const [p] = await db
      .insert(projects)
      .values({ organizationId: org.id, name: "Sample", repoUrl: REPO })
      .returning();
    const [g] = await db.insert(groups).values({ projectId: p.id, name: "프론트" }).returning();
    expect(g.scopeDescription).toBe("");
    expect(g.repoTags).toEqual([]);
    await expect(
      db.insert(groups).values({ projectId: p.id, name: "프론트" }),
    ).rejects.toThrow();
  } finally {
    await close();
  }
});
