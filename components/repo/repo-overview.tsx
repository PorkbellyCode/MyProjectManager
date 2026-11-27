import type { RepoPageData } from "@/lib/projects/admin";
import { repoFailureText, TRUNCATED_NOTICE } from "@/lib/repo/messages";
import { EmptyState } from "@/components/app-shell/page-frame";
import { Poller } from "@/components/review/poller";
import { TagSelect } from "./tag-select";

const when = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-[17px] font-semibold">{title}</h2>
      {children}
    </section>
  );
}

/** 레포 개요: 마지막 성공 분석의 내용 + 가장 최근 분석의 상태. 태그 수정은 리드만. */
export function RepoOverview({ projectId, data, canEdit }: { projectId: string; data: RepoPageData; canEdit: boolean }) {
  const { good, latest, analyzing, groups } = data;
  const overview = good?.overview ?? null;
  const groupName = (id: string | null) => groups.find((g) => g.id === id)?.name ?? null;
  const failedNewer = latest && latest.status === "failed";

  const tag = (kind: "modules" | "screens" | "apis", path: string, id: string | null) =>
    canEdit && good ? (
      <TagSelect projectId={projectId} snapshotId={good.id} kind={kind} path={path} value={id} groups={groups} />
    ) : (
      <span className="rounded-full border border-line px-2.5 py-0.5 text-xs text-muted-text">{groupName(id) ?? "태그 없음"}</span>
    );

  return (
    <div className="flex flex-col gap-8">
      <Poller active={analyzing} />
      <div className="flex flex-col gap-2 rounded-[14px] border border-line bg-surface px-5 py-4 text-sm" aria-live="polite">
        {analyzing && (
          <p role="status" className="font-medium">
            레포를 분석하는 중이에요. 끝나면 이 화면이 바뀌어요.
          </p>
        )}
        {failedNewer && (
          <p role="alert" className="text-destructive">
            마지막 분석이 실패했어요: {repoFailureText(latest.error)}.
          </p>
        )}
        {good ? (
          <p className="text-muted-text">
            마지막 분석 {when(good.createdAt)} · 성공{failedNewer ? " (아래는 마지막으로 성공한 결과예요)" : ""}
          </p>
        ) : (
          !analyzing && !failedNewer && <p className="text-muted-text">아직 분석한 적이 없어요.</p>
        )}
        {good?.facts?.truncated && <p className="text-muted-text">{TRUNCATED_NOTICE}</p>}
      </div>

      {!overview ? (
        !analyzing && <EmptyState title="보여줄 분석 결과가 없어요" body={canEdit ? "다시 분석을 눌러 시작해 보세요." : "리드가 분석을 시작하면 이곳에 나타나요."} />
      ) : (
        <>
          <Section title="기술 스택">
            <ul className="flex flex-wrap gap-2">
              {overview.stack.map((s) => (
                <li key={s} className="rounded-full bg-sunken px-3 py-1 text-sm">
                  {s}
                </li>
              ))}
            </ul>
          </Section>
          <Section title="도메인 맵">
            <ul className="grid gap-3 sm:grid-cols-2">
              {overview.domains.map((d) => (
                <li key={d.name} className="rounded-[14px] border border-line bg-surface p-4">
                  <p className="font-medium">{d.name}</p>
                  <p className="mt-1 font-mono text-xs leading-6 text-muted-text">{d.modulePaths.join(" · ") || "모듈 없음"}</p>
                </li>
              ))}
            </ul>
          </Section>
          <Section title="모듈">
            <List
              rows={overview.modules.map((m) => ({ key: m.path, main: m.path, sub: m.summary, tag: tag("modules", m.path, m.groupId) }))}
            />
          </Section>
          <Section title="화면">
            <List rows={overview.screens.map((s) => ({ key: s.path, main: s.name, sub: s.path, tag: tag("screens", s.path, s.groupId) }))} />
          </Section>
          <Section title="API">
            <List
              rows={overview.apis.map((a) => ({ key: a.path, main: `${a.method ?? ""} ${a.path}`.trim(), sub: null, tag: tag("apis", a.path, a.groupId) }))}
            />
          </Section>
        </>
      )}
    </div>
  );
}

function List({ rows }: { rows: { key: string; main: string; sub: string | null; tag: React.ReactNode }[] }) {
  if (rows.length === 0) return <p className="text-sm text-muted-text">찾은 항목이 없어요.</p>;
  return (
    <ul className="divide-y divide-line rounded-[14px] border border-line bg-surface">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center justify-between gap-4 px-4 py-3">
          <div className="min-w-0">
            <p className="truncate font-mono text-sm">{r.main}</p>
            {r.sub && <p className="truncate text-sm text-muted-text">{r.sub}</p>}
          </div>
          {r.tag}
        </li>
      ))}
    </ul>
  );
}
