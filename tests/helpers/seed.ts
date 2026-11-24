import { randomUUID } from "node:crypto";
import type { Db } from "@/lib/db";
import { organization } from "@/lib/db/schema";

export async function seedOrganization(db: Db, name: string) {
  const id = randomUUID();
  const [org] = await db
    .insert(organization)
    .values({ id, name, slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${id.slice(0, 8)}`, createdAt: new Date() })
    .returning();
  return org;
}
