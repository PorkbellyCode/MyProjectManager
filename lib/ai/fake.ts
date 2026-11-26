import { MockLanguageModelV4 } from "ai/test";

/**
 * MPM_FAKE_AI=1일 때 getModel이 돌려주는 가짜 모델.
 * 기본 응답은 `lib/ai/fake-rules.ts`의 규칙 표(키워드 기반, 결정적)다. 테스트는 `setFakeResponder`로 바꿀 수 있다.
 */
export type FakeCallContext = { modelId: string; prompt: unknown };
export type FakeResponder = (ctx: FakeCallContext) => unknown | Promise<unknown>;

/** 기본: 규칙 표. DB는 쓸 때 불러온다(빌드·테스트에서 연결 부작용이 없도록). */
const rulesResponder: FakeResponder = async (ctx) => {
  const [{ db }, { respondWithRules }] = await Promise.all([import("@/lib/db"), import("./fake-rules")]);
  return respondWithRules(ctx, db);
};

let responder: FakeResponder = rulesResponder;

/** null이면 기본(규칙 표)으로 되돌린다. */
export function setFakeResponder(fn: FakeResponder | null): void {
  responder = fn ?? rulesResponder;
}

export function createFakeModel(modelId: string): MockLanguageModelV4 {
  return new MockLanguageModelV4({
    provider: "fake",
    modelId,
    doGenerate: async (options) => {
      const body = await responder({ modelId, prompt: options.prompt });
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
