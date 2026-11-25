import { describe, expect, test, vi } from "vitest";

vi.mock("@/lib/env", () => ({
  env: { ANTHROPIC_API_KEY: "test-anthropic", OPENAI_API_KEY: undefined, GOOGLE_GENERATIVE_AI_API_KEY: "test-google" },
}));

import { getModel } from "@/lib/ai/registry";

describe("getModel", () => {
  test("키가 있는 제공자는 해당 제공자의 모델을 돌려준다(네트워크 호출 없음)", () => {
    const m = getModel("anthropic:claude-sonnet-5-5");
    expect(typeof m === "object" && "provider" in m && String(m.provider)).toContain("anthropic");
    expect(getModel("google:gemini-3.5-flash")).toBeTruthy();
  });

  test("키가 없거나 모르는 제공자는 한국어 오류", () => {
    expect(() => getModel("openai:gpt-5.5")).toThrow("API 키");
    expect(() => getModel("foo:bar")).toThrow("알 수 없는");
  });
});
