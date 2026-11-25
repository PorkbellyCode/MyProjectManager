import type { Db } from "@/lib/db";
import { projects } from "@/lib/db/schema";
import type { createAuth } from "@/lib/auth";

type Auth = ReturnType<typeof createAuth>;

export async function signUp(auth: Auth, email: string, name: string) {
  return (await auth.api.signUpEmail({ body: { email, password: "password-1234", name } })).user;
}

/** Better Auth 조직 + projects 행. 만든 사람은 lead가 된다. */
export async function makeProject(
  db: Db,
  auth: Auth,
  slug: string,
  creatorId: string,
  extra: Partial<typeof projects.$inferInsert> = {},
) {
  const org = await auth.api.createOrganization({ body: { name: slug, slug, userId: creatorId } });
  const [p] = await db
    .insert(projects)
    .values({ organizationId: org!.id, name: slug, repoUrl: "https://github.com/x/y", ...extra })
    .returning();
  return { project: p, orgId: org!.id };
}

export async function addMember(auth: Auth, orgId: string, userId: string, role: "lead" | "developer" | "requester") {
  await auth.api.addMember({ body: { organizationId: orgId, userId, role } });
}
