"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Info, Loader2, Send } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { MarkdownEditor } from "@/components/editor/markdown-editor";
import { Sparkle } from "@/components/review/ai-frame";
import { createDraftAction } from "@/app/p/[projectId]/tickets/actions";
import { ticketFormSchema, TITLE_MAX, type TicketFormValues } from "@/app/p/[projectId]/tickets/schemas";
import { CATEGORIES, CATEGORY_LABEL, URGENCIES, URGENCY_LABEL, URGENCY_LEVEL } from "@/lib/tickets/labels";
import type { TargetOptions } from "@/lib/tickets/detail";
import { fadeUpDelay } from "@/lib/motion";
import { cn } from "@/lib/utils";
import { TargetPicker } from "./target-picker";
import { UrgencyBars } from "./urgency-bars";

export const AI_UNAVAILABLE_MESSAGE = "이 프로젝트는 AI 검토를 쓸 수 없어요. 바로 제출돼요.";

type Intent = "review" | "submit";

/** 칩 모양 라디오(카테고리·긴급도). 화살표 키로 옮기고, 선택은 강조색 테두리 + 연한 바탕으로 보인다. */
function ChipRadio({ value, children }: { value: string; children: React.ReactNode }) {
  return (
    <RadioGroupPrimitive.Item
      value={value}
      className="inline-flex h-9 items-center gap-2 rounded-full pointer-coarse:h-11 border border-line bg-surface px-3.5 text-sm text-muted-text outline-none transition-[background-color,border-color,color,transform] duration-[120ms] hover:-translate-y-px hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/40 data-[state=checked]:border-brand data-[state=checked]:bg-brand-sel data-[state=checked]:font-medium data-[state=checked]:text-text"
    >
      {children}
    </RadioGroupPrimitive.Item>
  );
}

/**
 * 새 티켓 작성 폼: 제목, 본문(마크다운 + 이미지), 카테고리, 긴급도(기본 보통), 담당 대상(선택).
 * 버튼은 "바로 제출"과 "AI 검토 요청". AI를 못 쓰는 프로젝트는 검토 버튼 대신 안내 문구가 보인다.
 */
export function TicketForm({
  projectId,
  aiAvailable,
  targets,
}: {
  projectId: string;
  aiAvailable: boolean;
  targets: TargetOptions;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [intent, setIntent] = useState<Intent | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const form = useForm<TicketFormValues>({
    resolver: zodResolver(ticketFormSchema),
    defaultValues: { title: "", body: "", category: "defect", urgency: "normal", target: null },
  });
  const { errors } = form.formState;

  const send = (next: Intent) =>
    form.handleSubmit((values) => {
      setIntent(next);
      setFormError(null);
      startTransition(async () => {
        const res = await createDraftAction(projectId, { ...values, intent: next }).catch(() => null);
        if (!res || !res.ok) {
          const message = res?.error ?? "연결이 끊겼어요. 잠시 뒤에 다시 시도해 주세요.";
          setFormError(message);
          toast.error(message);
          setIntent(null);
          return;
        }
        router.push(`/p/${projectId}/tickets/${res.ticketId}`);
      });
    });

  const busy = pending || uploading;

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void send(aiAvailable ? "review" : "submit")(e);
      }}
      className="grid gap-x-12 gap-y-8 lg:grid-cols-[minmax(0,1fr)_320px]"
    >
      <div className="rise flex min-w-0 flex-col gap-6">
        <div className="flex flex-col gap-2">
          <Label htmlFor="ticket-title" className="text-sm font-medium">
            제목
          </Label>
          <Input
            id="ticket-title"
            autoFocus
            maxLength={TITLE_MAX}
            placeholder="무엇이 문제이거나 필요한지 한 줄로"
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? "ticket-title-error" : undefined}
            className="h-12 rounded-[10px] text-[17px] font-medium"
            {...form.register("title")}
          />
          {errors.title && (
            <p id="ticket-title-error" className="text-sm text-destructive">
              {errors.title.message}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <span className="text-sm font-medium" id="ticket-body-label">
            본문
          </span>
          <Controller
            control={form.control}
            name="body"
            render={({ field }) => (
              <MarkdownEditor
                value={field.value}
                onChange={field.onChange}
                projectId={projectId}
                label="본문"
                minHeight={260}
                placeholder="어디서, 무엇을 했을 때, 어떻게 됐는지 적어 주세요. 스크린샷은 붙여넣거나 끌어다 놓을 수 있어요."
                onUploadingChange={setUploading}
              />
            )}
          />
          <p className="text-[13px] text-faint">마크다운을 쓸 수 있어요. 이미지는 4MB까지 올릴 수 있어요.</p>
        </div>
      </div>

      <aside aria-label="티켓 속성" className="rise flex flex-col gap-7 lg:border-l lg:border-line lg:pl-10" style={fadeUpDelay(1)}>
        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">카테고리</legend>
          <Controller
            control={form.control}
            name="category"
            render={({ field }) => (
              <RadioGroupPrimitive.Root aria-label="카테고리" value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-2">
                {CATEGORIES.map((c) => (
                  <ChipRadio key={c} value={c}>
                    {CATEGORY_LABEL[c]}
                  </ChipRadio>
                ))}
              </RadioGroupPrimitive.Root>
            )}
          />
        </fieldset>

        <fieldset className="flex flex-col gap-3">
          <legend className="mb-3 text-sm font-medium">긴급도</legend>
          <Controller
            control={form.control}
            name="urgency"
            render={({ field }) => (
              <RadioGroupPrimitive.Root aria-label="긴급도" value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-2">
                {URGENCIES.map((u) => (
                  <ChipRadio key={u} value={u}>
                    <UrgencyBars level={URGENCY_LEVEL[u]} />
                    {URGENCY_LABEL[u]}
                  </ChipRadio>
                ))}
              </RadioGroupPrimitive.Root>
            )}
          />
          <p className="text-[13px] leading-[1.6] text-faint">정한 긴급도는 AI가 바꾸지 않아요.</p>
        </fieldset>

        <div className="flex flex-col gap-3">
          <Label htmlFor="ticket-target" className="text-sm font-medium">
            담당 대상 <span className="font-normal text-faint">(선택)</span>
          </Label>
          <Controller
            control={form.control}
            name="target"
            render={({ field }) => (
              <TargetPicker id="ticket-target" projectId={projectId} value={field.value} onChange={field.onChange} options={targets} />
            )}
          />
          {aiAvailable && <p className="text-[13px] leading-[1.6] text-faint">모르면 비워 두세요. AI 검토를 거치면 추천을 받아 고를 수 있어요.</p>}
        </div>

        <div className="flex flex-col gap-3 border-t border-line pt-6">
          {formError && (
            <p role="alert" className="text-sm text-destructive">
              {formError}
            </p>
          )}
          {aiAvailable ? (
            <>
              <Button type="button" size="lg" className="h-11 rounded-[10px] text-[15px] font-semibold" disabled={busy} onClick={(e) => void send("review")(e)}>
                {pending && intent === "review" ? <Loader2 className="animate-spin" aria-hidden /> : <Sparkle />}
                AI 검토 요청
              </Button>
              <Button type="button" variant="outline" className="h-10 rounded-[10px]" disabled={busy} onClick={(e) => void send("submit")(e)}>
                {pending && intent === "submit" ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                바로 제출
              </Button>
              <p className="text-[13px] leading-[1.6] text-faint">
                AI가 비슷한 티켓과 이미 해결된 건을 먼저 찾아보고, 빠진 정보를 몇 가지 물어요. 언제든 그대로 제출할 수 있어요.
              </p>
            </>
          ) : (
            <>
              <p className={cn("flex gap-2 rounded-[10px] border border-line bg-sunken px-3 py-2.5 text-[13px] leading-[1.6] text-muted-text")}>
                <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
                {AI_UNAVAILABLE_MESSAGE}
              </p>
              <Button type="button" size="lg" className="h-11 rounded-[10px] text-[15px] font-semibold" disabled={busy} onClick={(e) => void send("submit")(e)}>
                {pending ? <Loader2 className="animate-spin" aria-hidden /> : <Send aria-hidden />}
                바로 제출
              </Button>
            </>
          )}
          {uploading && <p className="text-[13px] text-faint">이미지를 올리는 중이에요. 끝나면 보낼 수 있어요.</p>}
        </div>
      </aside>
    </form>
  );
}
