import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { nextCookies } from "better-auth/next-js";
import { organization } from "better-auth/plugins";
import { headers } from "next/headers";
import { db, type Db } from "@/lib/db";
import { env } from "@/lib/env";
import * as schema from "@/lib/db/schema";
import { ac, developer, lead, requester } from "@/lib/auth-roles";

/**
 * R26: 조직 변경은 앱의 서버 액션(lib/projects/service)만 한다. 플러그인이 /api/auth/organization/*로 여는
 * 변경 엔드포인트는 모두 막는다(서비스의 티켓 이관·그룹 정리·이벤트 규칙을 우회하므로). 초대 수락과 읽기만 연다.
 * disabledPaths는 HTTP 요청만 막고, 서버 코드의 auth.api.* 호출(테스트·시드)에는 영향이 없다.
 */
export const DISABLED_ORG_PATHS = [
  "create",
  "update",
  "delete",
  "leave",
  "remove-member",
  "update-member-role",
  "invite-member",
  "cancel-invitation",
  "reject-invitation",
  "set-active",
  "set-active-team",
  "add-team-member",
  "remove-team-member",
  "create-team",
  "update-team",
  "remove-team",
  "create-role",
  "update-role",
  "delete-role",
].map((p) => `/organization/${p}`);

/** 조직 = 프로젝트. 테스트에서는 PGlite db를 넘겨 같은 설정의 인스턴스를 만든다. */
export function createAuth(database: Db, opts: { nextCookies?: boolean } = {}) {
  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL: env.BETTER_AUTH_URL,
    database: drizzleAdapter(database, { provider: "pg", schema }),
    emailAndPassword: { enabled: true },
    disabledPaths: DISABLED_ORG_PATHS,
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
