"use client";

import { useId, useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ALLOWED_IMAGE_TYPES, uploadImage } from "@/components/editor/image-upload";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import { answerQuestionsAction } from "@/app/p/[projectId]/tickets/actions";
import { answerQuestionsSchema } from "@/app/p/[projectId]/tickets/schemas";
import { MAX_ROUNDS, OTHER_OPTION, UNKNOWN_OPTION, UNKNOWN_VALUE, withDisplayOptions, type Question } from "@/lib/agents/interview";
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from "@/lib/storage/limits";
import type { Target } from "@/lib/tickets/targets";
import { listStagger } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { AiCard } from "./ai-frame";
import { SubmitAsIsButton, type CardProps } from "./submit-as-is";

export type QuestionsPayload = { round: number; questions: Question[] };

type Draft = {
  /** single/scale: 고른 선택지, multi: 고른 것들 */
  picked: string[];
  /** "직접 입력"에 적은 글 */
  custom: string;
  /** text 질문의 답 */
  text: string;
  unknown: boolean;
  urls: string[];
};

const empty: Draft = { picked: [], custom: "", text: "", unknown: false, urls: [] };

type AnswerOut = { questionId: string; value: string | string[]; attachmentUrls?: string[] };

/** 화면 상태 → 저장할 답(안 답한 질문은 null). "모르겠어요"는 'unknown'. */
export function toAnswer(q: Question, d: Draft): AnswerOut | null {
  if (d.unknown) return { questionId: q.id, value: UNKNOWN_VALUE };
  switch (q.type) {
    case "text":
      return d.text.trim() ? { questionId: q.id, value: d.text.trim() } : null;
    case "attachment":
      return d.urls.length ? { questionId: q.id, value: d.text.trim(), attachmentUrls: d.urls } : null;
    case "multi": {
      const values = d.picked.filter((v) => v !== OTHER_OPTION);
      if (d.picked.includes(OTHER_OPTION) && d.custom.trim()) values.push(d.custom.trim());
      return values.length ? { questionId: q.id, value: values } : null;
    }
    default: {
      const v = d.picked[0];
      if (!v) return null;
      if (v === OTHER_OPTION) return d.custom.trim() ? { questionId: q.id, value: d.custom.trim() } : null;
      return { questionId: q.id, value: v };
    }
  }
}

/**
 * 버튼 모양의 선택지. single/scale은 radiogroup(화살표로 이동·선택), multi는 체크 버튼 묶음.
 * 표시용 선택지에는 항상 "직접 입력"과 "모르겠어요"가 붙는다(withDisplayOptions).
 */
function OptionGroup({ q, d, onChange, labelId }: { q: Question; d: Draft; onChange: (d: Draft) => void; labelId: string }) {
  const options = withDisplayOptions(q).options ?? [];
  const multi = q.type === "multi";
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const isOn = (o: string) => (o === UNKNOWN_OPTION ? d.unknown : !d.unknown && d.picked.includes(o));

  const choose = (o: string) => {
    if (o === UNKNOWN_OPTION) return onChange({ ...d, unknown: multi ? !d.unknown : true, picked: [] });
    if (!multi) return onChange({ ...d, unknown: false, picked: [o] });
    const picked = d.picked.includes(o) ? d.picked.filter((x) => x !== o) : [...d.picked, o];
    onChange({ ...d, unknown: false, picked });
  };

  const selectedIndex = options.findIndex(isOn);
  const onKeyDown = (e: React.KeyboardEvent, i: number) => {
    if (multi) return;
    const delta = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!delta) return;
    e.preventDefault();
    const next = (i + delta + options.length) % options.length;
    refs.current[next]?.focus();
    choose(options[next]);
  };

  return (
    <div role={multi ? "group" : "radiogroup"} aria-labelledby={labelId} className="flex flex-wrap gap-2">
      {options.map((o, i) => {
        const on = isOn(o);
        const extra = o === OTHER_OPTION || o === UNKNOWN_OPTION;
        return (
          <button
            key={o}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role={multi ? "checkbox" : "radio"}
            aria-checked={on}
            tabIndex={multi || i === (selectedIndex < 0 ? 0 : selectedIndex) ? 0 : -1}
            onClick={() => choose(o)}
            onKeyDown={(e) => onKeyDown(e, i)}
            className={cn(
              "inline-flex h-9 items-center rounded-full border px-3.5 text-sm outline-none transition-[background-color,border-color,color,transform] duration-[120ms] hover:-translate-y-px focus-visible:ring-[3px] focus-visible:ring-ring/40",
              on
                ? "border-brand bg-surface font-medium text-text shadow-[inset_0_0_0_1px_var(--brand)]"
                : cn("border-line bg-surface text-text hover:border-faint/60", extra && "border-dashed text-muted-text"),
            )}
          >
            {o}
          </button>
        );
      })}
    </div>
  );
}

function AttachmentField({
  q,
  d,
  onChange,
  projectId,
  labelId,
  onBusy,
}: {
  q: Question;
  d: Draft;
  onChange: (d: Draft) => void;
  projectId: string;
  labelId: string;
  onBusy: (busy: boolean) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [message, setMessage] = useState("");

  const upload = async (files: File[]) => {
    const images = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
    if (images.length === 0) return setMessage("PNG, JPEG, GIF, WebP 이미지만 올릴 수 있어요.");
    const tooBig = images.find((f) => f.size > MAX_UPLOAD_BYTES);
    if (tooBig) return setMessage(TOO_LARGE_MESSAGE);
    setBusy(true);
    onBusy(true);
    setMessage("업로드 중…");
    try {
      const urls = await Promise.all(images.map((f) => uploadImage(f, projectId)));
      onChange({ ...d, unknown: false, urls: [...d.urls, ...urls] });
      setMessage(`이미지 ${urls.length}개를 올렸어요.`);
    } catch (e) {
      const msg = e instanceof Error && e.message && !e.message.startsWith("upload failed") ? e.message : "업로드하지 못했어요. 다시 시도해 주세요.";
      setMessage(msg);
      toast.error(msg);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          void upload([...e.dataTransfer.files]);
        }}
        onPaste={(e) => {
          const files = [...e.clipboardData.files];
          if (files.length) {
            e.preventDefault();
            void upload(files);
          }
        }}
        className={cn(
          "flex flex-wrap items-center gap-3 rounded-[10px] border border-dashed bg-surface px-4 py-3 transition-colors",
          over ? "border-brand" : "border-line",
        )}
      >
        <Button type="button" variant="outline" size="sm" className="rounded-lg" aria-describedby={labelId} disabled={busy} onClick={() => input.current?.click()}>
          {busy ? <Loader2 className="animate-spin" aria-hidden /> : <ImagePlus aria-hidden />}
          이미지 올리기
        </Button>
        <span className="text-[13px] text-faint">또는 여기에 붙여넣거나 끌어다 놓기 · 4MB까지</span>
        <input
          ref={input}
          type="file"
          hidden
          multiple
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          aria-label={`${q.prompt} 이미지 파일`}
          onChange={(e) => {
            if (e.target.files) void upload([...e.target.files]);
            e.target.value = "";
          }}
        />
      </div>
      {d.urls.length > 0 && (
        <ul className="flex flex-wrap gap-2">
          {d.urls.map((u, i) => (
            <li key={u} className="relative">
              {/* eslint-disable-next-line @next/next/no-img-element -- 방금 올린 사용자 이미지 */}
              <img src={u} alt={`올린 이미지 ${i + 1}`} className="size-20 rounded-lg border border-line object-cover" />
              <button
                type="button"
                aria-label={`올린 이미지 ${i + 1} 빼기`}
                onClick={() => onChange({ ...d, urls: d.urls.filter((x) => x !== u) })}
                className="absolute -right-2 -top-2 inline-flex size-6 items-center justify-center rounded-full border border-line bg-surface text-muted-text hover:text-text"
              >
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <p role="status" aria-live="polite" className="text-[13px] text-faint empty:hidden">
        {message}
      </p>
    </div>
  );
}

function QuestionField({
  q,
  index,
  d,
  onChange,
  projectId,
  onBusy,
}: {
  q: Question;
  index: number;
  d: Draft;
  onChange: (d: Draft) => void;
  projectId: string;
  onBusy: (busy: boolean) => void;
}) {
  const labelId = useId();
  const whyId = useId();
  const choice = q.type === "single" || q.type === "scale" || q.type === "multi";
  return (
    <li className="rise flex flex-col gap-3 border-t border-ai-ring/70 pt-5 first:border-t-0 first:pt-0" style={listStagger(index)}>
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
        <span aria-hidden className="font-mono text-[13px] text-faint">
          {index + 1}.
        </span>
        <span id={labelId} className="text-base font-medium">
          {q.prompt}
        </span>
        <span id={whyId} className="text-[13px] text-muted-text">
          · {q.why}
        </span>
      </div>
      <div className="flex flex-col gap-3 sm:pl-6">
        {choice && <OptionGroup q={q} d={d} onChange={onChange} labelId={labelId} />}
        {choice && !d.unknown && d.picked.includes(OTHER_OPTION) && (
          <Input
            autoFocus
            aria-label={`${q.prompt} 직접 입력`}
            placeholder="직접 적어 주세요"
            value={d.custom}
            onChange={(e) => onChange({ ...d, custom: e.target.value })}
            className="max-w-md rounded-[10px] bg-surface"
          />
        )}
        {q.type === "text" && (
          <div className="flex flex-col gap-2">
            <Textarea
              aria-labelledby={labelId}
              aria-describedby={whyId}
              disabled={d.unknown}
              placeholder="짧게 적어 주세요"
              value={d.text}
              onChange={(e) => onChange({ ...d, text: e.target.value })}
              className="min-h-20 rounded-[10px] bg-surface"
            />
            <button
              type="button"
              aria-pressed={d.unknown}
              onClick={() => onChange({ ...d, unknown: !d.unknown })}
              className={cn(
                "w-fit rounded-full border border-dashed px-3 py-1 text-[13px] outline-none transition-colors focus-visible:ring-[3px] focus-visible:ring-ring/40",
                d.unknown ? "border-brand bg-surface font-medium text-text" : "border-line text-muted-text hover:text-text",
              )}
            >
              {UNKNOWN_OPTION}
            </button>
          </div>
        )}
        {q.type === "attachment" && <AttachmentField q={q} d={d} onChange={onChange} projectId={projectId} labelId={labelId} onBusy={onBusy} />}
      </div>
    </li>
  );
}

/**
 * 질문 라운드 카드("라운드 n/2"). 질문마다 이유 한 줄, 선택지 버튼 + "직접 입력" + "모르겠어요", 첨부 질문은 업로드.
 * 안 답한 질문은 비워 둔 채 보낼 수 있다(하나 이상은 답해야 한다). "그대로 제출"은 언제나 된다.
 */
export function QuestionRound({ payload, target, ...card }: CardProps & { payload: QuestionsPayload; target: Target }) {
  const [drafts, setDrafts] = useState<Record<string, Draft>>({});
  const [uploading, setUploading] = useState(0);
  const { execute, pending, error } = useTicketAction();
  const answers = payload.questions.map((q) => toAnswer(q, drafts[q.id] ?? empty)).filter((a): a is AnswerOut => a !== null);
  const total = payload.questions.length;

  const send = () => {
    const parsed = answerQuestionsSchema.safeParse({ expectedVersion: card.version, answers });
    if (!parsed.success) return toast.error(parsed.error.issues[0]?.message ?? "답변을 확인해 주세요.");
    void execute(() => answerQuestionsAction(card.projectId, card.ticketId, parsed.data));
  };

  return (
    <AiCard provider={card.provider} label={`질문 라운드 ${payload.round}/${MAX_ROUNDS}`} heading={`라운드 ${payload.round}/${MAX_ROUNDS}`}>
      <p className="text-[15px] leading-[1.75]">
        {payload.round === 1 ? "해소된 건은 없어 보여요. 빨리 처리되도록 몇 가지만 물을게요." : "거의 다 됐어요. 하나만 더 여쭤볼게요."}
      </p>
      <ol className="flex flex-col gap-5">
        {payload.questions.map((q, i) => (
          <QuestionField
            key={q.id}
            q={q}
            index={i}
            d={drafts[q.id] ?? empty}
            onChange={(d) => setDrafts((all) => ({ ...all, [q.id]: d }))}
            projectId={card.projectId}
            onBusy={(b) => setUploading((n) => n + (b ? 1 : -1))}
          />
        ))}
      </ol>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <div className="flex flex-wrap items-center justify-end gap-3 border-t border-ai-ring/70 pt-4">
        <span className="mr-auto text-[13px] text-muted-text" aria-live="polite">
          {total}개 중 {answers.length}개 답함{answers.length < total ? " · 모르는 건 비워 둬도 돼요" : ""}
        </span>
        <SubmitAsIsButton {...card} target={target} />
        <Button type="button" className="rounded-[10px]" disabled={pending || uploading > 0 || answers.length === 0} onClick={send}>
          {pending && <Loader2 className="animate-spin" aria-hidden />}
          답변 보내기
        </Button>
      </div>
    </AiCard>
  );
}
