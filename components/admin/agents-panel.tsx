"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { saveAgentProfileAction } from "@/app/p/[projectId]/admin/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import type { AdminAgent } from "@/lib/projects/admin";
import type { AgentRole } from "@/lib/agents/profiles";

const ROLE_LABEL: Record<AgentRole, { name: string; hint: string }> = {
  resolver: { name: "해소 검사", hint: "중복이거나 이미 해결된 요청인지 확인해요." },
  lead: { name: "리드(인터뷰)", hint: "빠진 정보를 요청자에게 물어볼 질문을 만들어요." },
  recommender: { name: "대상 추천", hint: "처리할 그룹을 추천해요. 정하는 건 사람이에요." },
  summarizer: { name: "정리자", hint: "제출할 때 개발자가 읽기 좋은 정리본을 만들어요." },
  repo: { name: "레포 분석", hint: "레포 구조를 개요로 정리해요." },
};

const when = (d: Date) => d.toLocaleString("ko-KR", { timeZone: "Asia/Seoul", dateStyle: "medium", timeStyle: "short" });

function AgentCard({ projectId, agent }: { projectId: string; agent: AdminAgent }) {
  const { execute, pending, error } = useTicketAction();
  const [text, setText] = useState(agent.active.instructions);
  const label = ROLE_LABEL[agent.role];
  const dirty = text.trim() !== agent.active.instructions.trim();

  return (
    <section aria-label={`${label.name} 에이전트`} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-6">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="text-[17px] font-semibold">{label.name}</h3>
          <p className="text-sm text-muted-text">{label.hint}</p>
        </div>
        <span className="font-mono text-sm text-muted-text">현재 v{agent.active.version}</span>
      </div>
      <dl className="grid gap-x-6 gap-y-1 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted-text">모델</dt>
        <dd className="font-mono">{agent.active.modelId}</dd>
        <dt className="text-muted-text">도구</dt>
        <dd className="font-mono">{agent.active.toolNames.join(", ") || "없음"}</dd>
        <dt className="text-muted-text">최대 단계</dt>
        <dd className="font-mono">{agent.active.maxSteps}</dd>
      </dl>
      <p className="text-xs text-faint">모델과 도구는 지금은 바꿀 수 없어요.</p>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium">지시사항</span>
        <MarkdownEditor value={text} onChange={setText} projectId={projectId} label={`${label.name} 지시사항`} minHeight={200} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button
          type="button"
          disabled={pending || !dirty || !text.trim()}
          onClick={() => void execute(() => saveAgentProfileAction(projectId, { role: agent.role, instructions: text }), { success: "새 버전으로 저장했어요." })}
        >
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          저장 (새 버전)
        </Button>
        {!dirty && <span className="text-sm text-muted-text">바꾼 내용이 없어요.</span>}
      </div>
      <div>
        <h4 className="mb-2 text-sm font-medium">버전 목록</h4>
        <ol aria-label={`${label.name} 버전 목록`} className="flex flex-col divide-y divide-line rounded-[10px] border border-line">
          {agent.versions.map((v) => (
            <li key={v.id} className="px-3 py-2 text-sm">
              <details>
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono font-medium">v{v.version}</span>
                  <span className="text-muted-text">
                    {v.editorName ?? "알 수 없음"} · {when(v.createdAt)}
                  </span>
                  {v.version === agent.active.version && <span className="rounded-full bg-sunken px-2 py-0.5 text-xs">현재</span>}
                </summary>
                <pre className="mt-2 max-h-64 overflow-auto whitespace-pre-wrap rounded-lg bg-sunken p-3 font-mono text-xs leading-6">{v.instructions}</pre>
              </details>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

export function AgentsPanel({ projectId, agents }: { projectId: string; agents: AdminAgent[] }) {
  if (agents.length === 0) {
    return <p className="rounded-[14px] border border-line bg-surface p-6 text-sm text-muted-text">아직 에이전트 설정이 없어요.</p>;
  }
  return (
    <div className="flex flex-col gap-6">
      {agents.map((a) => (
        <AgentCard key={a.role} projectId={projectId} agent={a} />
      ))}
    </div>
  );
}
