/**
 * 시연 시드: `pnpm seed:demo` (DATABASE_URL 필요, 마이그레이션이 적용된 DB). 몇 번 실행해도 결과가 같다.
 * MPM_FAKE_AI=1이면 샘플 레포 분석 작업(repo.analyze)을 이 자리에서 바로 돌려 개요·근거용 커밋이 생기게 한다.
 * 그 밖에는 작업 큐에 넣어 두고 크론(/api/cron/jobs)이나 첫 화면 요청이 처리한다.
 */
import fs from "node:fs";
import path from "node:path";

for (const file of [".env.local", ".env"]) {
  if (fs.existsSync(file)) process.loadEnvFile(file);
}

async function main() {
  const { checkSeedTarget } = await import("@/lib/demo/guard");
  const target = checkSeedTarget(process.env.DATABASE_URL, { SEED_DEMO_CONFIRM: process.env.SEED_DEMO_CONFIRM });
  console.log(`시드 대상 데이터베이스: ${target.host}`);
  if (!target.allow) {
    console.error(target.message);
    process.exit(1);
  }
  // 환경 변수를 읽은 뒤에 불러온다(lib/env는 import 시점에 검증한다).
  const [{ db }, { createAuth }, { seedDemo, countSeed }, { runPending }, { handlers }] = await Promise.all([
    import("@/lib/db"),
    import("@/lib/auth"),
    import("@/lib/demo/seed"),
    import("@/lib/jobs/queue"),
    import("@/lib/jobs/handlers"),
  ]);
  const { env } = await import("@/lib/env");

  const handoverMarkdown = fs.readFileSync(path.resolve(__dirname, "../docs/demo/workwrap-handover.md"), "utf8");
  const result = await seedDemo(db, createAuth(db), { handoverMarkdown, log: (m) => console.log(m) });

  if (env.MPM_FAKE_AI === "1") {
    while ((await runPending(db, handlers)) > 0);
  }

  console.log(JSON.stringify({ created: result.created, counts: await countSeed(db, result.projectId) }, null, 2));
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
