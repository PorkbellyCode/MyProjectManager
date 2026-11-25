import { createAuthClient } from "better-auth/react";
import { organizationClient } from "better-auth/client/plugins";
import { ac, developer, lead, requester } from "@/lib/auth-roles";

export const authClient = createAuthClient({
  plugins: [organizationClient({ ac, roles: { requester, lead, developer } })],
});
