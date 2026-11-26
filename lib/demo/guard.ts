/** 시드 대상 DB를 보호한다(R27). 순수 함수: 주소와 환경 변수만 보고 허용·거절을 정한다. */
export type SeedTarget = { allow: boolean; host: string; message?: string };

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

export function checkSeedTarget(databaseUrl: string | undefined, env: { SEED_DEMO_CONFIRM?: string }): SeedTarget {
  if (!databaseUrl) return { allow: false, host: "(없음)", message: "DATABASE_URL이 없어요. 시드할 데이터베이스를 지정해 주세요." };
  let host: string;
  try {
    host = new URL(databaseUrl).hostname;
  } catch {
    return { allow: false, host: "(알 수 없음)", message: "DATABASE_URL 형식이 올바르지 않아요." };
  }
  if (LOCAL_HOSTS.has(host) || env.SEED_DEMO_CONFIRM === "1") return { allow: true, host };
  return {
    allow: false,
    host,
    message: [
      `대상 데이터베이스(${host})가 로컬이 아니라서 시드를 멈췄어요.`,
      "시연 시드는 비밀번호가 공개된(demo1234) 계정 7개와 리드 계정을 만들고, 시연 프로젝트가 서버의 AI 키(비용)를 쓰게 하며, 다시 실행하면 시드 그룹·도메인 지식·멤버를 시드 값으로 되돌려요.",
      "정말 이 데이터베이스에 넣으려면 SEED_DEMO_CONFIRM=1을 붙여 다시 실행하세요.",
    ].join("\n"),
  };
}
