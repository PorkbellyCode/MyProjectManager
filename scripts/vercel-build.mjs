import { spawnSync } from "node:child_process";

function run(args) {
  const r = spawnSync("pnpm", ["exec", ...args], { stdio: "inherit" });
  if (r.status !== 0) process.exit(r.status ?? 1);
}

// 프로덕션 배포에서만 마이그레이션한다(프리뷰가 프로덕션 DB를 건드리지 않도록).
if (process.env.VERCEL_ENV === "production") {
  run(["drizzle-kit", "migrate"]);
} else {
  console.log(`skip migrate (VERCEL_ENV=${process.env.VERCEL_ENV ?? ""})`);
}
run(["next", "build"]);
