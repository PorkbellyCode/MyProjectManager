import { defineConfig } from "drizzle-kit";

// 마이그레이션은 Neon 직접(unpooled) 연결을 우선 사용한다. 앱 런타임은 DATABASE_URL을 쓴다.
const url = process.env.DATABASE_URL_UNPOOLED ?? process.env.DATABASE_URL;

// DB 연결이 필요한 명령에서만 URL을 요구한다(generate는 오프라인 동작).
const needsDb = process.argv.some((a) => ["migrate", "push", "studio", "pull", "check", "up"].includes(a));
if (!url && needsDb) {
  throw new Error(
    "DATABASE_URL_UNPOOLED or DATABASE_URL must be set. drizzle-kit needs a database URL for migrate/push/studio.",
  );
}

export default defineConfig({
  dialect: "postgresql",
  schema: "./lib/db/schema/index.ts",
  out: "./drizzle",
  dbCredentials: { url: url ?? "postgres://placeholder:placeholder@localhost:5432/placeholder" },
});
