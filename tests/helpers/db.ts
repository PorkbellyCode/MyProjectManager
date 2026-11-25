import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import type { Db } from "@/lib/db";
import * as schema from "@/lib/db/schema";

export async function createTestDb(): Promise<{ db: Db; close(): Promise<void> }> {
  const client = new PGlite();
  const pg = drizzle(client, { schema });
  await migrate(pg, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return { db: pg, close: () => client.close() };
}
