import { describe, expect, test } from "vitest";
import { checkSeedTarget } from "@/lib/demo/guard";

describe("시드 대상 보호", () => {
  test.each(["postgres://u@localhost:5432/db", "postgres://u@127.0.0.1:54329/db", "postgres://u@[::1]:5432/db"])("로컬이면 허용: %s", (url) => {
    const r = checkSeedTarget(url, {});
    expect(r.allow).toBe(true);
  });

  test("로컬이 아니면 SEED_DEMO_CONFIRM=1 없이는 거절하고 호스트를 알린다", () => {
    const r = checkSeedTarget("postgres://u:pw@ep-abc.neon.tech/db", {});
    expect(r.allow).toBe(false);
    expect(r.host).toBe("ep-abc.neon.tech");
    expect(r.message).toContain("ep-abc.neon.tech");
    expect(r.message).toContain("SEED_DEMO_CONFIRM=1");
    expect(r.message).not.toContain("pw");
  });

  test("SEED_DEMO_CONFIRM=1이면 원격도 허용, 다른 값은 거절", () => {
    expect(checkSeedTarget("postgres://u@ep-abc.neon.tech/db", { SEED_DEMO_CONFIRM: "1" }).allow).toBe(true);
    expect(checkSeedTarget("postgres://u@ep-abc.neon.tech/db", { SEED_DEMO_CONFIRM: "true" }).allow).toBe(false);
  });

  test("주소가 없거나 잘못되면 거절", () => {
    expect(checkSeedTarget(undefined, {}).allow).toBe(false);
    expect(checkSeedTarget("not a url", { SEED_DEMO_CONFIRM: "1" }).allow).toBe(false);
  });
});
