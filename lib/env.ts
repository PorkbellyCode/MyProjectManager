import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

// 환경 변수는 이 파일로만 읽는다. 필수 값이 없으면 import 시점에 실패한다.
export const env = createEnv({
  server: {
    DATABASE_URL: z.string().min(1),
    BETTER_AUTH_SECRET: z.string().min(1),
    BETTER_AUTH_URL: z.string().url(),
    ANTHROPIC_API_KEY: z.string().min(1).optional(),
    OPENAI_API_KEY: z.string().min(1).optional(),
    GOOGLE_GENERATIVE_AI_API_KEY: z.string().min(1).optional(),
    BLOB_READ_WRITE_TOKEN: z.string().min(1),
    APP_ENCRYPTION_KEY: z.string().min(1),
    CRON_SECRET: z.string().min(1),
    LANGFUSE_PUBLIC_KEY: z.string().min(1).optional(),
    LANGFUSE_SECRET_KEY: z.string().min(1).optional(),
    LANGFUSE_BASEURL: z.string().url().optional(),
    MPM_FAKE_AI: z.literal("1").optional(),
    MPM_FAKE_BLOB: z.literal("1").optional(),
  },
  client: {},
  experimental__runtimeEnv: {},
  emptyStringAsUndefined: true,
  onValidationError: (issues) => {
    const detail = issues.map((i) => `${i.path?.join(".") ?? "?"}: ${i.message}`).join(", ");
    throw new Error(`환경 변수가 올바르지 않아요: ${detail}`);
  },
  skipValidation: !!process.env.SKIP_ENV_VALIDATION,
});
