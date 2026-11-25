import { cookies } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { listUserProjects } from "@/lib/projects/queries";
import { getPreferences } from "@/lib/preferences/service";
import { countUnread } from "@/lib/notifications/queries";
import { accentPair, onAccent, pickAccent, providerAiTokens, providerPalette } from "@/lib/theme/accent";
import { TopBar } from "./top-bar";

export const LAST_PROJECT_COOKIE = "mpm-project";

/**
 * 로그인한 사용자의 화면 틀. 테마와 강조색을 사용자 설정(user_preferences)과 프로젝트 설정에서 서버가 정해
 * 래퍼의 CSS 변수로 내보내므로 새로고침해도 깜빡이지 않는다.
 * projectId가 있으면 그 프로젝트(멤버가 아니면 404), 없으면 마지막으로 연 프로젝트 → 첫 프로젝트.
 * 요청 시점 데이터를 읽으므로 호출하는 쪽이 Suspense 안에서 렌더해야 한다.
 */
export async function AppShell({ projectId, children }: { projectId?: string; children: React.ReactNode }) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const [projects, prefs, unread] = await Promise.all([
    listUserProjects(db, user.id),
    getPreferences(db, user.id),
    countUnread(db, user.id),
  ]);

  let current = projectId ? projects.find((p) => p.id === projectId) : undefined;
  if (projectId && !current) notFound();
  if (!current) {
    const last = (await cookies()).get(LAST_PROJECT_COOKIE)?.value;
    current = projects.find((p) => p.id === last) ?? projects[0];
  }

  const provider = current?.defaultProvider ?? "anthropic";
  const projectAccent = pickAccent({ override: null, projectDefault: current?.accentDefault, provider });
  const accent = pickAccent({ override: prefs.accentOverride, projectDefault: current?.accentDefault, provider });
  const a = accentPair(accent);
  const base = accentPair(projectAccent);
  const ai = providerAiTokens(provider);

  const vars = {
    "--accent-l": a.light,
    "--accent-d": a.dark,
    "--on-accent-l": onAccent(a.light),
    "--on-accent-d": onAccent(a.dark),
    "--ai-tint-l": ai.light.tint,
    "--ai-tint-d": ai.dark.tint,
    "--ai-ring-l": ai.light.ring,
    "--ai-ring-d": ai.dark.ring,
    "--ai-text-l": ai.light.text,
    "--ai-text-d": ai.dark.text,
  } as React.CSSProperties;

  return (
    <div
      data-shell
      data-theme={prefs.theme === "system" ? undefined : prefs.theme}
      className="accent-scope flex min-h-screen flex-col bg-bg text-text"
      style={vars}
    >
      <a
        href="#main"
        className="sr-only rounded-lg bg-surface px-3 py-2 text-sm focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50"
      >
        본문으로 건너뛰기
      </a>
      <TopBar
        user={{ name: user.name, email: user.email }}
        projects={projects.map((p) => ({ id: p.id, name: p.name }))}
        current={current ? { id: current.id, name: current.name, role: current.role } : null}
        unread={unread}
        theme={prefs.theme}
        accentOverride={prefs.accentOverride}
        projectAccent={{
          light: base.light,
          dark: base.dark,
          onLight: onAccent(base.light),
          onDark: onAccent(base.dark),
          providerName: providerAiTokens(provider).name,
          label: providerPalette(provider).accent,
        }}
      />
      <main id="main" className="flex flex-1 flex-col">
        {children}
      </main>
    </div>
  );
}

/** Suspense fallback: 상단 바 자리만 잡아 둔다. */
export function ShellSkeleton() {
  return (
    <div className="accent-scope flex min-h-screen flex-col bg-bg" aria-busy="true">
      <div className="h-[69px] border-b border-line bg-surface" />
    </div>
  );
}
