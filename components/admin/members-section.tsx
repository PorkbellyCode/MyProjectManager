"use client";

import { useState, useSyncExternalStore } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Copy, Loader2, UserMinus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  cancelInvitationAction,
  changeMemberRoleAction,
  inviteMemberAction,
  removeMemberAction,
} from "@/app/p/[projectId]/admin/actions";
import { inviteSchema } from "@/app/p/[projectId]/admin/schemas";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import type { AdminInvitation, AdminMember } from "@/lib/projects/admin";
import type { MemberRole } from "@/lib/auth-roles";
import { z } from "zod";

const subscribeNothing = () => () => {};

export const ROLE_LABEL: Record<MemberRole, string> = { requester: "요청자", developer: "개발자", lead: "리드" };
const ROLES: MemberRole[] = ["requester", "developer", "lead"];

export const selectClass =
  "h-9 rounded-lg border border-line bg-surface px-2.5 text-sm outline-none pointer-coarse:h-11 focus-visible:ring-[3px] focus-visible:ring-ring/40 disabled:opacity-50";

function MemberRow({ projectId, m, self }: { projectId: string; m: AdminMember; self: boolean }) {
  const { execute, pending, error } = useTicketAction();
  // 고른 값은 액션이 도는 동안 그대로 보여주고, 실패했을 때만 서버 값으로 되돌린다.
  const [value, setValue] = useState<MemberRole>(m.role);
  // 하이드레이션이 끝나 핸들러가 붙었다는 표시(테스트가 기다린다).
  const hydrated = useSyncExternalStore(subscribeNothing, () => true, () => false);
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3" data-member={m.email}>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[15px] font-medium">
          {m.name}
          {self && <span className="ml-1.5 text-sm font-normal text-faint">(나)</span>}
        </p>
        <p className="truncate text-sm text-muted-text" title={m.email}>
          {m.email}
        </p>
        {self && <p className="text-xs text-faint">내 역할과 참여는 다른 리드가 바꿀 수 있어요.</p>}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </div>
      <select
        aria-label={`${m.name} 역할`}
        value={value}
        disabled={pending || self}
        data-hydrated={hydrated || undefined}
        onChange={(e) => {
          const next = e.target.value as MemberRole;
          setValue(next);
          void execute(() => changeMemberRoleAction(projectId, { userId: m.userId, role: next }), { success: "역할을 바꿨어요." }).then(
            (ok) => {
              if (!ok) setValue(m.role);
            },
          );
        }}
        className={selectClass}
      >
        {ROLES.map((r) => (
          <option key={r} value={r}>
            {ROLE_LABEL[r]}
          </option>
        ))}
      </select>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={pending || self}
        aria-label={`${m.name}님을 프로젝트에서 제외`}
        title={self ? "나는 제외할 수 없어요" : `${m.name}님을 프로젝트에서 제외`}
        className="pointer-coarse:min-h-11"
        onClick={() => {
          if (window.confirm(`${m.name}님을 프로젝트에서 제외할까요? 맡고 있던 티켓은 리드 큐로 옮겨져요.`))
            void execute(() => removeMemberAction(projectId, { userId: m.userId }), { success: "프로젝트에서 제외했어요." });
        }}
      >
        <UserMinus aria-hidden="true" />
        <span className="max-sm:sr-only">프로젝트에서 제외</span>
      </Button>
    </li>
  );
}

type InviteValues = z.infer<typeof inviteSchema>;

export function MembersSection({
  projectId,
  members,
  invitations,
  currentUserId,
}: {
  projectId: string;
  members: AdminMember[];
  invitations: AdminInvitation[];
  currentUserId: string;
}) {
  const { execute, pending, error } = useTicketAction();
  const cancel = useTicketAction();
  const form = useForm<InviteValues>({ resolver: zodResolver(inviteSchema), defaultValues: { email: "", role: "requester" } });
  const { errors } = form.formState;

  const submit = form.handleSubmit(async (v) => {
    const ok = await execute(() => inviteMemberAction(projectId, v), { success: "초대 링크를 만들었어요." });
    if (ok) form.reset({ email: "", role: v.role });
  });

  return (
    <section aria-labelledby="members-h" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1.5">
        <h2 id="members-h" className="text-xl font-semibold leading-[1.4]">
          멤버·초대
        </h2>
        <p className="max-w-prose text-sm leading-[1.75] text-muted-text">역할을 바꾸거나 이메일로 초대 링크를 만들어요.</p>
      </div>
      <ul aria-label="멤버 목록" className="divide-y divide-line rounded-[14px] border border-line bg-surface">
        {members.map((m) => (
          <MemberRow key={`${m.userId}:${m.role}`} projectId={projectId} m={m} self={m.userId === currentUserId} />
        ))}
      </ul>

      <form noValidate onSubmit={submit} className="flex flex-wrap items-end gap-3 rounded-[14px] border border-line bg-surface p-4" aria-label="멤버 초대">
        <div className="flex min-w-[240px] flex-1 flex-col gap-2">
          <Label htmlFor="invite-email">초대할 이메일</Label>
          <Input id="invite-email" type="email" placeholder="name@company.com" autoComplete="off" aria-invalid={!!errors.email} {...form.register("email")} />
          {errors.email && <p className="text-sm text-destructive">{errors.email.message}</p>}
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="invite-role">역할</Label>
          <select id="invite-role" className={`${selectClass} h-10`} {...form.register("role")}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </div>
        <Button type="submit" disabled={pending}>
          {pending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <UserPlus aria-hidden="true" />}
          초대하기
        </Button>
        {error && (
          <p role="alert" className="basis-full text-sm text-destructive">
            {error}
          </p>
        )}
      </form>

      {invitations.length > 0 && (
        <div className="flex flex-col gap-2">
          <h3 className="text-sm font-medium">대기 중인 초대</h3>
          <ul aria-label="대기 중인 초대" className="divide-y divide-line rounded-[14px] border border-line bg-surface">
            {invitations.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="truncate text-[15px]">
                    {i.email} <span className="text-sm text-muted-text">· {ROLE_LABEL[i.role]}</span>
                  </p>
                  <p className="truncate font-mono text-xs text-muted-text" data-testid="invite-link">
                    /invite/{i.id}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    void navigator.clipboard?.writeText(`${window.location.origin}/invite/${i.id}`);
                    toast.success("링크를 복사했어요.");
                  }}
                >
                  <Copy aria-hidden="true" />
                  링크 복사
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={cancel.pending}
                  onClick={() => void cancel.execute(() => cancelInvitationAction(projectId, { invitationId: i.id }), { success: "초대를 취소했어요." })}
                >
                  취소
                </Button>
              </li>
            ))}
          </ul>
          <p className="text-xs text-faint">메일은 보내지 않아요. 링크를 직접 전달해 주세요. 7일 동안 유효해요.</p>
        </div>
      )}
    </section>
  );
}
