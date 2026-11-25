import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { createTestDb } from "./helpers/db";
import { createAuth } from "@/lib/auth";
import { ForbiddenError, getMembership, requireMember } from "@/lib/access";
import { projects } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import type { Db } from "@/lib/db";

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;
let project: { id: string; organizationId: string };
let creator: { id: string }, requester: { id: string }, outsider: { id: string };

async function signUp(email: string, name: string) {
  const r = await auth.api.signUpEmail({ body: { email, password: "password-1234", name } });
  return r.user;
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db);
  creator = await signUp("lead@example.com", "리드");
  requester = await signUp("req@example.com", "요청자");
  outsider = await signUp("out@example.com", "외부인");
  const org = await auth.api.createOrganization({
    body: { name: "데모", slug: "demo", userId: creator.id },
  });
  await auth.api.addMember({ body: { organizationId: org!.id, userId: requester.id, role: "requester" } });
  const [p] = await db
    .insert(projects)
    .values({ organizationId: org!.id, name: "데모", repoUrl: "https://github.com/x/y" })
    .returning();
  project = p;
});
afterAll(async () => close());

describe("access", () => {
  test("비멤버는 404", async () => {
    await expect(requireMember(db, project.id, outsider.id)).rejects.toThrow(
      /NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/,
    );
  });
  test("없는 프로젝트도 404", async () => {
    await expect(
      requireMember(db, "00000000-0000-0000-0000-000000000000", creator.id),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404|NEXT_NOT_FOUND/);
  });
  test("조직 생성자는 lead", async () => {
    const m = await getMembership(db, project.id, creator.id);
    expect(m!.role).toBe("lead");
    expect(m!.joinedAt).toBeInstanceOf(Date);
  });
  test("요청자 역할", async () => {
    expect((await requireMember(db, project.id, requester.id)).role).toBe("requester");
  });
  test("요청자가 lead 전용 → ForbiddenError", async () => {
    await expect(requireMember(db, project.id, requester.id, ["lead"])).rejects.toBeInstanceOf(
      ForbiddenError,
    );
  });
  test("허용 역할이면 통과", async () => {
    await expect(requireMember(db, project.id, creator.id, ["lead"])).resolves.toEqual({ role: "lead" });
  });
  test("비멤버는 getMembership null", async () => {
    expect(await getMembership(db, project.id, outsider.id)).toBeNull();
  });
});

describe("초대", () => {
  async function invite(expiresAt?: Date) {
    const [p] = await db.select().from(projects).where(eq(projects.id, project.id));
    const inv = await auth.api.createInvitation({
      body: { email: "new@example.com", role: "developer", organizationId: p.organizationId },
      headers: await headersFor("lead@example.com"),
    });
    if (expiresAt) {
      const { invitation } = await import("@/lib/db/schema");
      await db.update(invitation).set({ expiresAt }).where(eq(invitation.id, inv!.id));
    }
    return inv!;
  }
  async function headersFor(email: string) {
    const res = await auth.api.signInEmail({ body: { email, password: "password-1234" }, returnHeaders: true });
    const cookie = res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
    return new Headers({ cookie });
  }

  test("만료된 초대 수락 시 멤버가 생기지 않는다", async () => {
    const inv = await invite(new Date(Date.now() - 1000));
    const u = await signUp("new@example.com", "신규");
    const h = await headersFor("new@example.com");
    await expect(auth.api.acceptInvitation({ body: { invitationId: inv.id }, headers: h })).rejects.toThrow();
    expect(await getMembership(db, project.id, u.id)).toBeNull();
  });

  test("유효한 초대 수락 시 지정 역할 멤버가 된다", async () => {
    const inv = await invite();
    const h = await headersFor("new@example.com");
    await auth.api.acceptInvitation({ body: { invitationId: inv.id }, headers: h });
    const { user } = await import("@/lib/db/schema");
    const [u] = await db.select().from(user).where(eq(user.email, "new@example.com"));
    expect((await getMembership(db, project.id, u.id))!.role).toBe("developer");
  });
});
