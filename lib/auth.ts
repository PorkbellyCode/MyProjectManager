import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { headers } from "next/headers";
import { db, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";
import { ac, developer, lead, requester } from "@/lib/auth-roles";

/** 조직 = 프로젝트. 테스트에서는 PGlite db를 넘겨 같은 설정의 인스턴스를 만든다. */
export function createAuth(database: Db, opts: { nextCookies?: boolean } = {}) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    plugins: [
      organization({
        ac,
        roles: { requester, lead, developer },
        creatorRole: "lead",
      }),
      ...(opts.nextCookies ? [nextCookies()] : []),
    ],
  });
}

export const auth = createAuth(db, { nextCookies: true });

export async function getSessionUser(): Promise<{ id: string; email: string; name: string } | null> {
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return null;
  const { id, email, name } = session.user;
  return { id, email, name };
}
