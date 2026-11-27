"use client";

import { useState } from "react";
import { Loader2, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { deleteDomainDocAction, upsertDomainDocAction } from "@/app/p/[projectId]/admin/actions";
import { useTicketAction } from "@/components/ticket/use-ticket-action";

type Doc = { id: string; title: string; body: string };

function DocCard({ projectId, doc }: { projectId: string; doc: Doc }) {
  const { execute, pending, error } = useTicketAction();
  const [body, setBody] = useState(doc.body);
  return (
    <section aria-label={`도메인 지식: ${doc.title}`} className="flex flex-col gap-3 rounded-[14px] border border-line bg-surface p-6">
      <h3 className="text-[17px] font-semibold">{doc.title}</h3>
      <MarkdownEditor value={body} onChange={setBody} projectId={projectId} label={`${doc.title} 내용`} minHeight={140} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button
          type="button"
          disabled={pending || body === doc.body}
          onClick={() => void execute(() => upsertDomainDocAction(projectId, { title: doc.title, body }), { success: "저장했어요." })}
        >
          저장
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={pending}
          onClick={() => {
            if (window.confirm(`"${doc.title}" 항목을 지울까요?`)) void execute(() => deleteDomainDocAction(projectId, { docId: doc.id }), { success: "지웠어요." });
          }}
        >
          <Trash2 aria-hidden="true" />
          삭제
        </Button>
      </div>
    </section>
  );
}

export function DomainPanel({ projectId, docs }: { projectId: string; docs: Doc[] }) {
  const { execute, pending, error } = useTicketAction();
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [nonce, setNonce] = useState(0);

  return (
    <div className="flex flex-col gap-6">
      {docs.length === 0 && <p className="text-sm text-muted-text">아직 항목이 없어요.</p>}
      {docs.map((d) => (
        <DocCard key={`${d.id}:${d.body.length}`} projectId={projectId} doc={d} />
      ))}
      <section aria-label="새 항목" className="flex flex-col gap-3 rounded-[14px] border border-dashed border-line bg-surface p-6">
        <h3 className="text-[17px] font-semibold">새 항목</h3>
        <div className="flex flex-col gap-2">
          <Label htmlFor="doc-title">제목</Label>
          <Input id="doc-title" value={title} maxLength={80} onChange={(e) => setTitle(e.target.value)} />
        </div>
        <MarkdownEditor key={nonce} value={body} onChange={setBody} projectId={projectId} label="새 항목 내용" minHeight={120} />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button
            type="button"
            disabled={pending || !title.trim()}
            onClick={async () => {
              const ok = await execute(() => upsertDomainDocAction(projectId, { title, body }), { success: "추가했어요." });
              if (ok) {
                setTitle("");
                setBody("");
                setNonce((n) => n + 1);
              }
            }}
          >
            {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Plus aria-hidden="true" />}
            항목 추가
          </Button>
        </div>
      </section>
    </div>
  );
}
