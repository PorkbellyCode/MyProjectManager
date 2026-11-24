"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

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
      <main>
        <p>{pending ? "초대를 수락하는 중이에요..." : null}</p>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  }

  return (
    <main>
      <h1>{props.projectName} 프로젝트에 초대받았어요</h1>
      <form onSubmit={onSignUp}>
        <label>이메일 <input value={props.email} readOnly /></label>
        <label>이름 <input name="name" required /></label>
        <label>비밀번호 <input name="password" type="password" required minLength={8} autoComplete="new-password" /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>가입하고 참여하기</button>
      </form>
      <p><a href="/login">이미 계정이 있어요</a></p>
    </main>
  );
}
