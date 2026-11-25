import { MockLanguageModelV4 } from "ai/test";

/**
 * MPM_FAKE_AI=1일 때 getModel이 돌려주는 가짜 모델의 뼈대.
 * 구체적인 응답 규칙은 Task 14(일반 규칙), Task 17(시드 전용 규칙)에서 `setFakeResponder`로 정한다.
 */
export type FakeCallContext = { modelId: string; prompt: unknown };
export type FakeResponder = (ctx: FakeCallContext) => unknown;

/** 자리표시 응답: 빈 객체 JSON. */
const placeholder: FakeResponder = () => ({});
let responder: FakeResponder = placeholder;

export function setFakeResponder(fn: FakeResponder | null): void {
  responder = fn ?? placeholder;
}

export function createFakeModel(modelId: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "fake",
    modelId,
    doGenerate: async (options) => {
      const body = responder({ modelId, prompt: options.prompt });
      return {
        content: [{ type: "text", text: typeof body === "string" ? body : JSON.stringify(body) }],
        finishReason: { unified: "stop", raw: undefined },
        usage: {
          inputTokens: { total: 0, noCache: 0, cacheRead: undefined, cacheWrite: undefined },
          outputTokens: { total: 0, text: 0, reasoning: undefined },
        },
        warnings: [],
      };
    },
  });
}
