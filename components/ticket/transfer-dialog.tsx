"use client";

import { useId, useState } from "react";
import { Controller, useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Loader2 } from "lucide-react";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { assignTargetAction, resolveAction, transferAction } from "@/app/p/[projectId]/tickets/actions";
import { resolveFormSchema, targetSchema, type ActionResult } from "@/app/p/[projectId]/tickets/schemas";
import { refsFromForm } from "@/lib/tickets/linked-refs";
import type { TargetOptions } from "@/lib/tickets/detail";
import type { Target } from "@/lib/tickets/targets";
import { TargetPicker, type TargetRecommendation } from "./target-picker";
import { useTicketAction } from "./use-ticket-action";

type Base = { projectId: string; ticketId: string; version: number };

const sameTarget = (a: Target, b: Target) =>
  a === b || (a !== null && b !== null && (a.kind === "user" ? b.kind === "user" && a.userId === b.userId : b.kind === "group" && a.groupId === b.groupId));

/** 패널의 트리거 버튼 모양(상세 화면 속성 패널 폭에 맞춘다). */
export function PanelButton({ primary, children, ...props }: React.ComponentProps<typeof Button> & { primary?: boolean }) {
  return (
    <Button type="button" variant={primary ? "default" : "outline"} className={primary ? "h-11 w-full rounded-[10px] text-[15px] font-semibold" : "h-10 w-full rounded-[10px] pointer-coarse:h-11"} {...props}>
      {children}
    </Button>
  );
}

function ErrorText({ id, message }: { id: string; message?: string }) {
  if (!message) return null;
  return (
    <p id={id} className="text-sm text-destructive">
      {message}
    </p>
  );
}

/**
 * 사유를 받아 실행하는 다이얼로그(보류, 다시 열기, 안 하기로 함 제안). 사유는 필수다.
 * 실패하면 다이얼로그를 열어 둔 채 안내하고, 충돌이면 닫고 화면을 새로 고친다(useTicketAction).
 */
export function ReasonDialog({
  trigger,
  primary,
  title,
  description,
  label,
  placeholder,
  submit,
  required,
  success,
  run,
}: {
  trigger: string;
  primary?: boolean;
  title: string;
  description: string;
  label: string;
  placeholder?: string;
  submit: string;
  required: string;
  success: string;
  run: (reason: string) => Promise<ActionResult>;
}) {
  const [open, setOpen] = useState(false);
  const errId = useId();
  const fieldId = useId();
  const { execute, pending } = useTicketAction();
  const schema = z.object({ reason: z.string().trim().min(1, required).max(2000, "사유는 2000자 이하로 적어 주세요.") });
  const form = useForm<z.infer<typeof schema>>({ resolver: zodResolver(schema), defaultValues: { reason: "" } });
  const err = form.formState.errors.reason?.message;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <PanelButton primary={primary}>{trigger}</PanelButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((v) =>
            execute(() => run(v.reason.trim()), { success, onSuccess: () => setOpen(false), onConflict: () => setOpen(false) }),
          )}
        >
          <DialogHeader>
            <DialogTitle>{title}</DialogTitle>
            <DialogDescription>{description}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <Label htmlFor={fieldId}>{label}</Label>
            <Textarea
              id={fieldId}
              autoFocus
              placeholder={placeholder}
              aria-invalid={!!err}
              aria-describedby={err ? errId : undefined}
              {...form.register("reason")}
            />
            <ErrorText id={errId} message={err} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              {submit}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

const transferForm = z.object({
  target: targetSchema,
  reason: z.string().trim().min(1, "이관 사유를 적어 주세요.").max(2000, "사유는 2000자 이하로 적어 주세요."),
});

/** 이관: 다른 사람·그룹(또는 리드 큐)으로 넘긴다. 대상과 사유 필수, 지금 대상과 같으면 막는다. */
export function TransferDialog({ projectId, ticketId, version, current, options }: Base & { current: Target; options: TargetOptions }) {
  const [open, setOpen] = useState(false);
  const reasonId = useId();
  const errId = useId();
  const { execute, pending } = useTicketAction();
  const form = useForm<z.infer<typeof transferForm>>({
    resolver: zodResolver(transferForm.refine((v) => !sameTarget(v.target, current), { path: ["target"], message: "지금과 다른 대상을 골라 주세요." })),
    defaultValues: { target: current, reason: "" },
  });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset({ target: current, reason: "" });
      }}
    >
      <DialogTrigger asChild>
        <PanelButton>이관</PanelButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((v) =>
            execute(() => transferAction(projectId, ticketId, { expectedVersion: version, target: v.target, reason: v.reason.trim() }), {
              success: "이관했어요. 새 대상에게 알렸어요.",
              onSuccess: () => setOpen(false),
              onConflict: () => setOpen(false),
            }),
          )}
        >
          <DialogHeader>
            <DialogTitle>티켓을 이관할까요?</DialogTitle>
            <DialogDescription>새 대상에게 알림이 가고, 담당자는 비워져요. 받는 쪽이 이해할 수 있게 사유를 남겨 주세요.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">이관할 대상</span>
            <Controller
              control={form.control}
              name="target"
              render={({ field }) => (
                <TargetPicker projectId={projectId} value={field.value} onChange={field.onChange} options={options} label="이관할 대상" invalid={!!errors.target} />
              )}
            />
            <ErrorText id={`${errId}-t`} message={errors.target?.message} />
          </div>
          <div className="flex flex-col gap-2">
            <Label htmlFor={reasonId}>이관 사유</Label>
            <Textarea id={reasonId} placeholder="예: 서버 응답 문제라 백엔드가 봐야 해요" aria-invalid={!!errors.reason} aria-describedby={errors.reason ? errId : undefined} {...form.register("reason")} />
            <ErrorText id={errId} message={errors.reason?.message} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              이관하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 리드 큐 티켓의 대상 정하기(lead). AI 추천이 있으면 미리 채우고 ✦ 추천으로 표시한다(참고용, 고르는 건 사람). */
export function AssignDialog({
  projectId,
  ticketId,
  version,
  options,
  recommended,
  primary,
}: Base & { options: TargetOptions; recommended: TargetRecommendation | null; primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const initial = recommended?.target ?? null;
  const [target, setTarget] = useState<Target>(initial);
  const [error, setError] = useState<string | null>(null);
  const errId = useId();
  const { execute, pending } = useTicketAction();

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (target === null) {
      setError("사람이나 그룹을 골라 주세요.");
      return;
    }
    void execute(() => assignTargetAction(projectId, ticketId, { expectedVersion: version, target }), {
      success: "대상을 정했어요. 대상에게 알렸어요.",
      onSuccess: () => setOpen(false),
      onConflict: () => setOpen(false),
    });
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) {
          setTarget(initial);
          setError(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <PanelButton primary={primary}>대상 지정</PanelButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <form noValidate className="flex flex-col gap-5" onSubmit={submit}>
          <DialogHeader>
            <DialogTitle>대상을 정할까요?</DialogTitle>
            <DialogDescription>사람을 고르면 그 사람에게 배정되고, 그룹을 고르면 그룹 큐로 가요.</DialogDescription>
          </DialogHeader>
          <div className="flex flex-col gap-2">
            <span className="text-sm font-medium">지정할 대상</span>
            <TargetPicker
              projectId={projectId}
              value={target}
              onChange={(t) => {
                setTarget(t);
                setError(null);
              }}
              options={options}
              recommended={recommended}
              label="지정할 대상"
              invalid={!!error}
            />
            <ErrorText id={errId} message={error ?? undefined} />
          </div>
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              지정하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

/** 처리 완료: PR 번호·커밋 SHA는 선택. 요청자 확인 카드에 링크로 보인다. */
export function ResolveDialog({ projectId, ticketId, version, primary }: Base & { primary?: boolean }) {
  const [open, setOpen] = useState(false);
  const prId = useId();
  const shaId = useId();
  const { execute, pending } = useTicketAction();
  const form = useForm<z.infer<typeof resolveFormSchema>>({ resolver: zodResolver(resolveFormSchema), defaultValues: { pr: "", commits: "" } });
  const errors = form.formState.errors;

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) form.reset();
      }}
    >
      <DialogTrigger asChild>
        <PanelButton primary={primary}>처리 완료</PanelButton>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <form
          noValidate
          className="flex flex-col gap-5"
          onSubmit={form.handleSubmit((v) =>
            execute(() => resolveAction(projectId, ticketId, { expectedVersion: version, linkedRefs: refsFromForm(v) }), {
              success: "처리 완료로 표시했어요. 요청자에게 확인을 부탁했어요.",
              onSuccess: () => setOpen(false),
              onConflict: () => setOpen(false),
            }),
          )}
        >
          <DialogHeader>
            <DialogTitle>처리 완료로 표시할까요?</DialogTitle>
            <DialogDescription>요청자가 확인하면 종결돼요. 관련 PR이나 커밋을 남기면 요청자 화면에 링크로 보여요.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 sm:grid-cols-[120px_minmax(0,1fr)]">
            <div className="flex flex-col gap-2">
              <Label htmlFor={prId}>PR 번호</Label>
              <Input id={prId} inputMode="numeric" placeholder="예: 42" className="font-mono" aria-invalid={!!errors.pr} {...form.register("pr")} />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={shaId}>커밋 SHA</Label>
              <Input id={shaId} placeholder="예: a3f91c2" className="font-mono" aria-invalid={!!errors.commits} {...form.register("commits")} />
            </div>
          </div>
          <p className="-mt-2 text-[13px] text-faint">둘 다 선택이에요. 커밋은 공백이나 쉼표로 여러 개 적을 수 있어요.</p>
          <ErrorText id={`${prId}-e`} message={errors.pr?.message ?? errors.commits?.message} />
          <DialogFooter>
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
              취소
            </Button>
            <Button type="submit" disabled={pending}>
              {pending && <Loader2 className="animate-spin" aria-hidden />}
              처리 완료하기
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
