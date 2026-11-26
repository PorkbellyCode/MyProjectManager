import { afterAll, beforeAll, describe, expect, test } from "vitest";
import { and, eq } from "drizzle-orm";
import { createTestDb } from "./helpers/db";
import { addMember, makeProject, signUp } from "./helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { member, organization } from "@/lib/db/schema";

let db: Db;
let close: () => Promise<void>;
let auth: ReturnType<typeof createAuth>;
let orgId: string;
let devId: string;
let leadId: string;
let cookie: string;
let leadCookie: string;

const post = (path: string, body: unknown, c: string) =>
  auth.handler(
    new Request(`http://localhost:3000/api/auth${path}`, {
      method: "POST",
      headers: { "content-type": "application/json", cookie: c, origin: "http://localhost:3000" },
      body: JSON.stringify(body),
    }),
  );

async function login(email: string): Promise<string> {
  const res = await auth.api.signInEmail({ body: { email, password: "password-1234" }, asResponse: true });
  return res.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  auth = createAuth(db);
  const lead = await signUp(auth, "lead@x.com", "리드");
  const dev = await signUp(auth, "dev@x.com", "개발자");
  leadId = lead.id;
  devId = dev.id;
  const p = await makeProject(db, auth, "disabled-paths", lead.id);
  orgId = p.orgId;
  await addMember(auth, orgId, dev.id, "developer");
  cookie = await login("dev@x.com");
  leadCookie = await login("lead@x.com");
});
afterAll(async () => close());

const roleOf = async (userId: string) =>
  (await db.select({ role: member.role }).from(member).where(and(eq(member.organizationId, orgId), eq(member.userId, userId))))[0]?.role;

describe("R26: 플러그인의 조직 변경 엔드포인트는 막혀 있다", () => {
  test("멤버의 organization/leave는 404이고 멤버십이 그대로다", async () => {
    const res = await post("/organization/leave", { organizationId: orgId }, cookie);
    expect(res.status).toBe(404);
    expect(await roleOf(devId)).toBe("developer");
  });

  test("리드의 update-member-role / remove-member / create / invite-member도 404이고 아무것도 바뀌지 않는다", async () => {
    const orgsBefore = (await db.select().from(organization)).length;
    const calls: [string, unknown][] = [
      ["/organization/update-member-role", { organizationId: orgId, memberId: "x", role: "requester" }],
      ["/organization/remove-member", { organizationId: orgId, memberIdOrEmail: "dev@x.com" }],
      ["/organization/create", { name: "몰래", slug: "sneaky" }],
      ["/organization/invite-member", { organizationId: orgId, email: "a@b.com", role: "lead" }],
    ];
    for (const [path, body] of calls) expect((await post(path, body, leadCookie)).status, path).toBe(404);
    expect(await roleOf(devId)).toBe("developer");
    expect(await roleOf(leadId)).toBe("lead");
    expect((await db.select().from(organization)).length).toBe(orgsBefore);
  });

  test("초대 수락과 읽기 엔드포인트는 열려 있다(404가 아니다)", async () => {
    const res = await auth.handler(
      new Request("http://localhost:3000/api/auth/organization/list", { headers: { cookie } }),
    );
    expect(res.status).toBe(200);
    const accept = await post("/organization/accept-invitation", { invitationId: "nope" }, cookie);
    expect(accept.status).not.toBe(404);
  });
});
