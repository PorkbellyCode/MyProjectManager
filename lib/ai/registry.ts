import { createAnthropic } from "@ai-sdk/anthropic";
import { createGoogleGenerativeAI } from "@ai-sdk/google";
import { createOpenAI } from "@ai-sdk/openai";
import { createProviderRegistry, type LanguageModel } from "ai";
import { env } from "@/lib/env";
import { createFakeModel } from "./fake";

// 제공자 SDK(@ai-sdk/*)는 이 파일에서만 import한다. 키는 lib/env로만 읽는다.
let registry: ReturnType<typeof buildRegistry> | null = null;

function buildRegistry() {
  return createProviderRegistry({
    anthropic: createAnthropic({ apiKey: env.ANTHROPIC_API_KEY }),
    openai: createOpenAI({ apiKey: env.OPENAI_API_KEY }),
    google: createGoogleGenerativeAI({ apiKey: env.GOOGLE_GENERATIVE_AI_API_KEY }),
  });
}

const KEY_BY_PROVIDER: Record<string, string | undefined> = {
  anthropic: env.ANTHROPIC_API_KEY,
  openai: env.OPENAI_API_KEY,
  google: env.GOOGLE_GENERATIVE_AI_API_KEY,
};

/** `"<provider>:<model>"` → LanguageModel. MPM_FAKE_AI=1이면 가짜 모델을 돌려준다. */
export function getModel(modelId: string): LanguageModel {
  if (env.MPM_FAKE_AI === "1") return createFakeModel(modelId);
  const provider = modelId.split(":")[0];
  if (!(provider in KEY_BY_PROVIDER)) throw new Error(`알 수 없는 모델 제공자예요: ${modelId}`);
  if (!KEY_BY_PROVIDER[provider]) throw new Error(`${provider} API 키가 설정되지 않았어요.`);
  registry ??= buildRegistry();
  return registry.languageModel(modelId as `${"anthropic" | "openai" | "google"}:${string}`);
}
