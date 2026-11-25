import { eq } from "drizzle-orm";
import { z } from "zod";
import type { Db } from "@/lib/db";
import { userPreferences, type ThemePreference } from "@/lib/db/schema";
import { HEX_RE } from "@/lib/theme/accent";

export type Preferences = { theme: ThemePreference; accentOverride: string | null };

export const DEFAULT_PREFERENCES: Preferences = { theme: "system", accentOverride: null };

/**
 * 부분 갱신. 키가 없으면 그대로 두고, accentOverride가 null이면 프로젝트 기본값으로 돌아간다.
 */
export const preferencesPatchSchema = z
  .object({
    theme: z.enum(["light", "dark", "system"]).optional(),
    accentOverride: z
      .string()
      .regex(HEX_RE, "#RRGGBB 형식으로 입력해 주세요")
      .transform((v) => v.toUpperCase())
      .nullable()
      .optional(),
  })
  .strict();

export type PreferencesPatch = z.input<typeof preferencesPatchSchema>;

export async function getPreferences(db: Db, userId: string): Promise<Preferences> {
  const [row] = await db
    .select({ theme: userPreferences.theme, accentOverride: userPreferences.accentOverride })
    .from(userPreferences)
    .where(eq(userPreferences.userId, userId))
    .limit(1);
  return row ?? DEFAULT_PREFERENCES;
}

export async function savePreferences(db: Db, userId: string, patch: PreferencesPatch): Promise<Preferences> {
  const parsed = preferencesPatchSchema.parse(patch);
  const current = await getPreferences(db, userId);
  const next: Preferences = {
    theme: parsed.theme ?? current.theme,
    accentOverride: parsed.accentOverride === undefined ? current.accentOverride : parsed.accentOverride,
  };
  await db
    .insert(userPreferences)
    .values({ userId, ...next })
    .onConflictDoUpdate({ target: userPreferences.userId, set: { ...next, updatedAt: new Date() } });
  return next;
}
