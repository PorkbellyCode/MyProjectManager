"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { RadioGroup as RadioGroupPrimitive } from "radix-ui";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { createProjectAction } from "@/app/projects/new/actions";
import { newProjectSchema, type NewProjectValues } from "@/app/p/[projectId]/admin/schemas";
import { AI_PROVIDERS, providerAiTokens } from "@/lib/theme/accent";

export function NewProjectForm() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [formError, setFormError] = useState<string | null>(null);
  const form = useForm<NewProjectValues>({
    resolver: zodResolver(newProjectSchema),
    defaultValues: { name: "", repoUrl: "", githubToken: "", defaultProvider: "anthropic" },
  });
  const { errors } = form.formState;

  const submit = form.handleSubmit((values) => {
    setFormError(null);
    startTransition(async () => {
      const res = await createProjectAction(values).catch(() => null);
      if (!res || !res.ok) {
        const message = res?.error ?? "연결이 끊겼어요. 잠시 뒤에 다시 시도해 주세요.";
        setFormError(message);
        toast.error(message);
        return;
      }
      router.push(`/p/${res.projectId}/repo`);
    });
  });

  return (
    <form noValidate onSubmit={submit} className="flex max-w-xl flex-col gap-6">
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-name">프로젝트 이름</Label>
        <Input id="project-name" autoFocus aria-invalid={!!errors.name} {...form.register("name")} />
        {errors.name && <p className="text-sm text-destructive">{errors.name.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-repo">GitHub 주소</Label>
        <Input id="project-repo" placeholder="https://github.com/owner/repo" aria-invalid={!!errors.repoUrl} {...form.register("repoUrl")} />
        {errors.repoUrl && <p className="text-sm text-destructive">{errors.repoUrl.message}</p>}
      </div>
      <div className="flex flex-col gap-2">
        <Label htmlFor="project-token">GitHub 토큰 (선택)</Label>
        <Input id="project-token" type="password" autoComplete="off" placeholder="비공개 레포일 때만 필요해요" {...form.register("githubToken")} />
        <p className="text-sm text-muted-text">암호화해서 저장하고, 저장한 뒤에는 다시 보여주지 않아요.</p>
      </div>
      <div className="flex flex-col gap-2">
        <span className="text-sm font-medium" id="provider-label">
          기본 AI 제공자
        </span>
        <Controller
          control={form.control}
          name="defaultProvider"
          render={({ field }) => (
            <RadioGroupPrimitive.Root aria-labelledby="provider-label" value={field.value} onValueChange={field.onChange} className="flex flex-wrap gap-2">
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
          )}
        />
        <p className="text-sm text-muted-text">화면 강조색이 이 제공자의 색을 따라가요.</p>
      </div>
      {formError && (
        <p role="alert" className="text-sm text-destructive">
          {formError}
        </p>
      )}
      <div>
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="animate-spin" aria-hidden="true" />}
          프로젝트 만들기
        </Button>
      </div>
    </form>
  );
}
