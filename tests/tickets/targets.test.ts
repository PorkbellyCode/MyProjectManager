import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "../helpers/db";
import { makeProject, signUp } from "../helpers/world";
import { createAuth } from "@/lib/auth";
import { groups, member } from "@/lib/db/schema";
import type { Db } from "@/lib/db";
import { InvalidTargetError, validateTarget } from "@/lib/tickets/targets";

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;
let p1: { id: string }, p2: { id: string };
let orgId: string;
let lead: { id: string }, dev: { id: string }, req: { id: string }, gone: { id: string }, other: { id: string };
let g1: { id: string }, g2: { id: string };

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db);
  lead = await signUp(auth, "l@example.com", "리드");
  dev = await signUp(auth, "d@example.com", "개발자");
  req = await signUp(auth, "r@example.com", "요청자");
  gone = await signUp(auth, "g@example.com", "빠진사람");
  other = await signUp(auth, "o@example.com", "다른프로젝트");
  const a = await makeProject(db, auth, "proj-a", lead.id);
  p1 = a.project;
  orgId = a.orgId;
  await auth.api.addMember({ body: { organizationId: orgId, userId: dev.id, role: "developer" } });
  await auth.api.addMember({ body: { organizationId: orgId, userId: req.id, role: "requester" } });
  await auth.api.addMember({ body: { organizationId: orgId, userId: gone.id, role: "developer" } });
  const b = await makeProject(db, auth, "proj-b", other.id);
  p2 = b.project;
  [g1] = await db.insert(groups).values({ projectId: p1.id, name: "백엔드" }).returning();
  [g2] = await db.insert(groups).values({ projectId: p2.id, name: "남의그룹" }).returning();
});
afterAll(async () => close());

describe("validateTarget", () => {
  test("null(리드 큐)은 그대로", async () => {
    expect(await validateTarget(db, p1.id, null)).toBeNull();
  });
  test("프로젝트 멤버(리드/개발자)와 자기 프로젝트 그룹은 통과", async () => {
    const u = { kind: "user", userId: dev.id } as const;
    expect(await validateTarget(db, p1.id, u)).toEqual(u);
    const l = { kind: "user", userId: lead.id } as const;
    expect(await validateTarget(db, p1.id, l)).toEqual(l);
    const g = { kind: "group", groupId: g1.id } as const;
    expect(await validateTarget(db, p1.id, g)).toEqual(g);
  });
  test("프로젝트에서 빠진 사람/다른 프로젝트 사람·그룹/없는 그룹 → InvalidTargetError", async () => {
    await db.delete(member).where(and(eq(member.organizationId, orgId), eq(member.userId, gone.id)));
    const bad = [
      { kind: "user", userId: gone.id },
      { kind: "user", userId: other.id },
      { kind: "user", userId: "no-such-user" },
      { kind: "group", groupId: g2.id },
      { kind: "group", groupId: "00000000-0000-0000-0000-000000000000" },
    ] as const;
    for (const target of bad) {
      await expect(validateTarget(db, p1.id, target)).rejects.toThrow("대상이 이 프로젝트에 없어요");
      await expect(validateTarget(db, p1.id, target)).rejects.toBeInstanceOf(InvalidTargetError);
    }
  });
  test("요청자 역할 사람은 대상이 될 수 없다", async () => {
    await expect(validateTarget(db, p1.id, { kind: "user", userId: req.id })).rejects.toBeInstanceOf(
      InvalidTargetError,
    );
  });
  test("그룹이 삭제되면 거부", async () => {
    const [g] = await db.insert(groups).values({ projectId: p1.id, name: "임시" }).returning();
    await db.delete(groups).where(eq(groups.id, g.id));
    await expect(validateTarget(db, p1.id, { kind: "group", groupId: g.id })).rejects.toBeInstanceOf(
      InvalidTargetError,
    );
  });
});
