import { createAccessControl } from "better-auth/plugins/access";
import { defaultStatements } from "better-auth/plugins/organization/access";

export type MemberRole = "requester" | "lead" | "developer";
export const MEMBER_ROLES: readonly MemberRole[] = ["requester", "lead", "developer"];

export function isMemberRole(v: string): v is MemberRole {
  return (MEMBER_ROLES as readonly string[]).includes(v);
}

// 프로젝트 내 세부 권한은 lib/access.ts + 서비스 계층이 판단한다.
// 여기서는 Better Auth 조직 API(멤버·초대 관리) 권한만 정의한다.
export const ac = createAccessControl({
  ...defaultStatements,
  ticket: ["create", "read", "triage", "close"],
});

export const lead = ac.newRole({
  organization: ["update"],
  member: ["create", "update", "delete"],
  invitation: ["create", "cancel"],
  ticket: ["create", "read", "triage", "close"],
});
export const developer = ac.newRole({ ticket: ["create", "read", "triage"] });
export const requester = ac.newRole({ ticket: ["create", "read"] });
