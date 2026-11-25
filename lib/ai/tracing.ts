import { env } from "@/lib/env";

/** Langfuse 키가 둘 다 있을 때만 추적을 켠다. */
export function langfuseEnabled(): boolean {
  return Boolean(env.LANGFUSE_PUBLIC_KEY && env.LANGFUSE_SECRET_KEY);
}

/** instrumentation.ts에서 한 번 호출한다. 키가 없으면 아무것도 등록하지 않는다. */
export async function registerTracing(): Promise<void> {
  if (!langfuseEnabled()) return;
  const [{ LangfuseSpanProcessor }, { NodeTracerProvider }, { registerTelemetry }, { OpenTelemetry }] =
    await Promise.all([
      import("@langfuse/otel"),
      import("@opentelemetry/sdk-trace-node"),
      import("ai"),
      import("@ai-sdk/otel"),
    ]);
  const processor = new LangfuseSpanProcessor({
    publicKey: env.LANGFUSE_PUBLIC_KEY,
    secretKey: env.LANGFUSE_SECRET_KEY,
    baseUrl: env.LANGFUSE_BASEURL,
    // 서버리스에서는 배치로 쌓아 두면 잃어버릴 수 있다.
    exportMode: "immediate",
  });
  new NodeTracerProvider({ spanProcessors: [processor] }).register();
  registerTelemetry(new OpenTelemetry());
}
