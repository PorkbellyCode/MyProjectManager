"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import { AuthFrame } from "@/components/app-shell/auth-frame";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const EXPIRED = "초대가 만료됐어요. 관리자에게 다시 요청해 주세요.";

export function InviteAccept(props: {
  invitationId: string;
  email: string;
  projectName: string;
  projectId: string | null;
  loggedIn: boolean;
}) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(props.loggedIn);
  const started = useRef(false);

  async function accept() {
    setPending(true);
    const { error } = await authClient.organization.acceptInvitation({ invitationId: props.invitationId });
    if (error) {
      setPending(false);
      return setError(EXPIRED);
    }
    router.push(props.projectId ? `/p/${props.projectId}/tickets` : "/");
    router.refresh();
  }

  // 로그인 상태면 바로 수락한다.
  useEffect(() => {
    if (props.loggedIn && !started.current) {
      started.current = true;
      void accept();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function onSignUp(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signUp.email({
      email: props.email,
      name: String(f.get("name")),
      password: String(f.get("password")),
    });
    if (error) {
      setPending(false);
      return setError("가입에 실패했어요. 이미 가입한 이메일이면 로그인 후 다시 열어 주세요.");
    }
    await accept();
  }

  if (props.loggedIn) {
    return (
      <AuthFrame title="초대를 수락하는 중이에요">
        <p className="text-sm text-muted-text" aria-live="polite">
          {pending ? "잠시만 기다려 주세요..." : null}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
      </AuthFrame>
    );
  }

  return (
    <AuthFrame title={`${props.projectName} 프로젝트에 초대받았어요`} description="계정을 만들면 바로 참여할 수 있어요.">
      <form onSubmit={onSignUp} className="flex flex-col gap-5">
        <div className="flex flex-col gap-2">
          <Label htmlFor="email">이메일</Label>
          <Input id="email" value={props.email} readOnly />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="name">이름</Label>
          <Input id="name" name="name" required autoComplete="name" />
        </div>
        <div className="flex flex-col gap-2">
          <Label htmlFor="password">비밀번호</Label>
          <Input id="password" name="password" type="password" required minLength={8} autoComplete="new-password" />
        </div>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <Button type="submit" disabled={pending} className="w-full">
          가입하고 참여하기
        </Button>
        <p className="text-center text-sm text-muted-text">
          <a href="/login" className="underline underline-offset-4 hover:text-text">
            이미 계정이 있어요
          </a>
        </p>
      </form>
    </AuthFrame>
  );
}
