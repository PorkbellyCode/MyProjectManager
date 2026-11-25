export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerTracing } = await import("./lib/ai/tracing");
  await registerTracing();
}
