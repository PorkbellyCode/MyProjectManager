"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { preferencesPatchSchema, savePreferences, type Preferences } from "@/lib/preferences/service";
import { THEME_COOKIE } from "@/lib/theme/constants";

export type SavePreferencesResult = { ok: true; preferences: Preferences } | { ok: false; error: string };

/** 테마와 개인 강조색을 저장한다. accentOverride: null = 프로젝트 기본값으로. 키를 빼면 그대로 둔다. */
export async function savePreferencesAction(input: unknown): Promise<SavePreferencesResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, error: "로그인이 필요해요." };
  const parsed = preferencesPatchSchema.safeParse(input);
  if (!parsed.success) {
    return { ok: false, error: z.prettifyError(parsed.error).split("\n")[0] ?? "설정 값이 올바르지 않아요." };
  }
  const preferences = await savePreferences(db, user.id, parsed.data);
  // 첫 페인트 전 스크립트가 읽는 쿠키(다른 기기에서 바꾼 값은 다음 서버 렌더에서 맞춰진다).
  (await cookies()).set(THEME_COOKIE, preferences.theme, { path: "/", maxAge: 60 * 60 * 24 * 365, sameSite: "lax" });
  revalidatePath("/", "layout");
  return { ok: true, preferences };
}
