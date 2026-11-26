"use client";

import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  createGroupAction,
  deleteGroupAction,
  setGroupMembersAction,
  updateGroupAction,
} from "@/app/p/[projectId]/admin/actions";
import { groupFormSchema, type GroupFormValues } from "@/app/p/[projectId]/admin/schemas";
import { useTicketAction } from "@/components/ticket/use-ticket-action";
import type { AdminGroup, AdminMember } from "@/lib/projects/admin";
import { ROLE_LABEL } from "./members-section";

function GroupFields({ form, idPrefix }: { form: ReturnType<typeof useForm<GroupFormValues>>; idPrefix: string }) {
  const { errors } = form.formState;
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-name`}>그룹 이름</Label>
        <Input id={`${idPrefix}-name`} aria-invalid={!!errors.name} {...form.register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor={`${idPrefix}-tags`}>레포 태그 (쉼표로 구분)</Label>
        <Input id={`${idPrefix}-tags`} placeholder="web, ui" {...form.register("repoTags")} />
      </div>
      <div className="flex flex-col gap-2 sm:col-span-2">
        <Label htmlFor={`${idPrefix}-scope`}>담당 범위</Label>
        <Input id={`${idPrefix}-scope`} placeholder="예: 화면, 입력, 표시" aria-invalid={!!errors.scopeDescription} {...form.register("scopeDescription")} />
        {errors.scopeDescription && <p className="text-sm text-destructive">{errors.scopeDescription.message}</p>}
      </div>
    </div>
  );
}

function GroupCard({ projectId, group, staff }: { projectId: string; group: AdminGroup; staff: AdminMember[] }) {
  const { execute, pending, error } = useTicketAction();
  const [picked, setPicked] = useState<string[]>(group.memberIds);
  const form = useForm<GroupFormValues>({
    resolver: zodResolver(groupFormSchema),
    defaultValues: { name: group.name, scopeDescription: group.scopeDescription, repoTags: group.repoTags.join(", ") },
  });
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  const membersDirty = [...picked].sort().join() !== [...group.memberIds].sort().join();

  return (
    <section aria-label={`그룹 ${group.name}`} className="flex flex-col gap-4 rounded-[14px] border border-line bg-surface p-5">
      <form
        noValidate
        onSubmit={form.handleSubmit((v) => void execute(() => updateGroupAction(projectId, { ...v, groupId: group.id }), { success: "그룹을 저장했어요." }))}
        className="flex flex-col gap-4"
      >
        <GroupFields form={form} idPrefix={`g-${group.id}`} />
        <div className="flex gap-2">
          <Button type="submit" size="sm" disabled={pending || !form.formState.isDirty}>
            그룹 저장
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={pending}
            onClick={() => {
              if (window.confirm(`"${group.name}" 그룹을 지울까요? 이 그룹 큐에서 기다리던 티켓은 리드 큐로 옮겨져요.`))
                void execute(() => deleteGroupAction(projectId, { groupId: group.id }), { success: "그룹을 지웠어요." });
            }}
          >
            <Trash2 aria-hidden="true" />
            삭제
          </Button>
        </div>
      </form>
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-1 text-sm font-medium">그룹원</legend>
        {staff.length === 0 ? (
          <p className="text-sm text-muted-text">개발자나 리드가 없어요.</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {staff.map((m) => (
              <li key={m.userId}>
                <label className="inline-flex cursor-pointer items-center gap-2 rounded-full border border-line px-3 py-1.5 text-sm has-[:checked]:border-brand has-[:checked]:bg-brand-sel">
                  <input type="checkbox" className="accent-[var(--brand)]" checked={picked.includes(m.userId)} onChange={() => toggle(m.userId)} />
                  {m.name}
                  <span className="text-xs text-muted-text">{ROLE_LABEL[m.role]}</span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <div>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={pending || !membersDirty}
            onClick={() => void execute(() => setGroupMembersAction(projectId, { groupId: group.id, userIds: picked }), { success: "그룹원을 저장했어요." })}
          >
            그룹원 저장
          </Button>
        </div>
      </fieldset>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </section>
  );
}

export function GroupsSection({ projectId, groups, members }: { projectId: string; groups: AdminGroup[]; members: AdminMember[] }) {
  const { execute, pending, error } = useTicketAction();
  const staff = members.filter((m) => m.role !== "requester");
  const form = useForm<GroupFormValues>({ resolver: zodResolver(groupFormSchema), defaultValues: { name: "", scopeDescription: "", repoTags: "" } });

  return (
    <section aria-labelledby="groups-h" className="flex flex-col gap-4">
      <h2 id="groups-h" className="text-[17px] font-semibold">
        그룹과 그룹원
      </h2>
      <p className="max-w-prose text-sm leading-[1.75] text-muted-text">
        그룹은 티켓을 받는 큐예요. 그룹원은 개발자나 리드만 될 수 있고, 요청자로 바꾸면 그룹에서 빠져요.
      </p>
      {groups.map((g) => (
        <GroupCard key={`${g.id}:${g.name}:${g.scopeDescription}:${g.repoTags.join()}:${g.memberIds.join()}`} projectId={projectId} group={g} staff={staff} />
      ))}
      <form
        noValidate
        aria-label="새 그룹"
        onSubmit={form.handleSubmit(async (v) => {
          const ok = await execute(() => createGroupAction(projectId, v), { success: "그룹을 만들었어요." });
          if (ok) form.reset();
        })}
        className="flex flex-col gap-4 rounded-[14px] border border-dashed border-line bg-surface p-5"
      >
        <h3 className="text-sm font-medium">새 그룹</h3>
        <GroupFields form={form} idPrefix="new-group" />
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            <Plus aria-hidden="true" />
            그룹 만들기
          </Button>
        </div>
      </form>
    </section>
  );
}
