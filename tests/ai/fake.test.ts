import { afterEach, describe, expect, test, vi } from "vitest";

vi.mock("@/lib/env", () => ({ env: { MPM_FAKE_AI: "1" } }));

import { generateText } from "ai";
import { getModel } from "@/lib/ai/registry";
import { setFakeResponder } from "@/lib/ai/fake";

afterEach(() => setFakeResponder(null));

describe("MPM_FAKE_AI=1", () => {
  test("getModel은 키 없이도 가짜 모델을 주고 responder 훅을 쓴다", async () => {
    setFakeResponder(() => ({ hello: "world" }));
    const res = await generateText({ model: getModel("anthropic:claude-sonnet-5-5"), prompt: "hi" });
    expect(JSON.parse(res.text)).toEqual({ hello: "world" });
  });
});
