import { betterAuth } from "better-auth";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { organization } from "better-auth/plugins";
import { db } from "@/lib/db";

// Task 1 최소 설정: 스키마 생성용. Task 2가 이 파일을 완성한다.
export const auth = betterAuth({
  database: drizzleAdapter(db, { provider: "pg" }),
  plugins: [organization()],
});
