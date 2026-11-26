"use client";

import { useState } from "react";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { setAccentDefaultAction, setDefaultProviderAction, setGithubTokenAction } from "@/app/p/[projectId]/admin/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { AI_PROVIDERS, normalizeHex, providerAiTokens, providerPalette } from "@/lib/theme/accent";
import type { ProjectSummary } from "@/lib/projects/admin";

function Card({ title, id, children }: { title: string; id: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-5">
      <h2 id={id} className="text-[17px] font-semibold">
        {title}
      </h2>
      {children}
    </section>
  );
}

function ProviderCard({ projectId, project }: { projectId: string; project: ProjectSummary }) {
  const { execute, pending, error } = useTicketAction();
  return (
    <Card title="기본 AI 제공자" id="provider-h">
      <RadioGroupPrimitive.Root
        aria-labelledby="provider-h"
        value={project.defaultProvider}
        disabled={pending}
        onValueChange={(v) => void execute(() => setDefaultProviderAction(projectId, { provider: v }), { success: "기본 AI 제공자를 바꿨어요." })}
        className="flex flex-wrap gap-2"
      >
        {AI_PROVIDERS.map((p) => (
          <RadioGroupPrimitive.Item
            key={p}
            value={p}
            className="inline-flex h-9 items-center rounded-full border border-line bg-surface px-3.5 text-sm text-muted-text outline-none focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=checked]:border-brand data-[state=checked]:bg-brand-sel data-[state=checked]:font-medium data-[state=checked]:text-text"
          >
            {providerAiTokens(p).name}
          </RadioGroupPrimitive.Item>
        ))}
      </RadioGroupPrimitive.Root>
      <p className="text-sm text-muted-text">이미 만든 에이전트의 모델은 그대로예요. 화면 기본 강조색만 이 제공자를 따라가요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

function AccentCard({ projectId, project }: { projectId: string; project: ProjectSummary }) {
  const { execute, pending, error, setError } = useTicketAction();
  const [hex, setHex] = useState(project.accentDefault ?? "");
  const fallback = providerPalette(project.defaultProvider).accent;
  const valid = normalizeHex(hex);
  return (
    <Card title="프로젝트 기본 강조색" id="accent-h">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="accent-hex">강조색 (#RRGGBB)</Label>
          <Input id="accent-hex" value={hex} placeholder={fallback} onChange={(e) => { setHex(e.target.value); setError(null); }} className="w-40 font-mono" />
        </div>
        <span aria-hidden="true" className="size-10 rounded-lg border border-line" style={{ background: valid ?? fallback }} />
        <Button type="button" disabled={pending || !valid} onClick={() => void execute(() => setAccentDefaultAction(projectId, { hex: hex.trim() }), { success: "강조색을 저장했어요." })}>
          저장
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !project.accentDefault}
          onClick={() => void execute(() => setAccentDefaultAction(projectId, { hex: null }), { success: "제공자 색으로 돌렸어요.", onSuccess: () => setHex("") })}
        >
          제공자 색으로
        </Button>
      </div>
      <p className="text-sm text-muted-text">비워 두면 기본 AI 제공자의 색을 써요. 각자 프로필 메뉴에서 자기 화면의 색을 따로 고를 수 있어요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

function TokenCard({ projectId, project }: { projectId: string; project: ProjectSummary }) {
  const { execute, pending, error } = useTicketAction();
  const [token, setToken] = useState("");
  return (
    <Card title="GitHub 토큰" id="token-h">
      <p className="text-sm">
        상태: <strong data-testid="token-status">{project.hasGithubToken ? "토큰 등록됨" : "없음"}</strong>
        <span className="ml-2 text-muted-text">{project.repoUrl.replace("https://github.com/", "")}</span>
      </p>
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex flex-col gap-2">
          <Label htmlFor="token-input">{project.hasGithubToken ? "새 토큰으로 바꾸기" : "토큰 등록"}</Label>
          <Input id="token-input" type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} className="w-72" />
        </div>
        <Button
          type="button"
          disabled={pending || !token.trim()}
          onClick={() => void execute(() => setGithubTokenAction(projectId, { token }), { success: "토큰을 저장했어요.", onSuccess: () => setToken("") })}
        >
          저장
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending || !project.hasGithubToken}
          onClick={() => void execute(() => setGithubTokenAction(projectId, { token: null }), { success: "토큰을 지웠어요." })}
        >
          지우기
        </Button>
      </div>
      <p className="text-sm text-muted-text">저장한 토큰은 암호화되고, 다시 보여주지 않아요.</p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </Card>
  );
}

export function ProjectSettings({ projectId, project }: { projectId: string; project: ProjectSummary }) {
  return (
    <div className="flex flex-col gap-6">
      <ProviderCard projectId={projectId} project={project} />
      <AccentCard projectId={projectId} project={project} />
      <TokenCard projectId={projectId} project={project} />
    </div>
  );
}
