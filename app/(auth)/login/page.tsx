"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

export default function LoginPage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setPending(true);
    const f = new FormData(e.currentTarget);
    const { error } = await authClient.signIn.email({
      email: String(f.get("email")),
      password: String(f.get("password")),
    });
    setPending(false);
    if (error) return setError("이메일 또는 비밀번호가 올바르지 않아요.");
    router.push("/");
    router.refresh();
  }

  return (
    <main>
      <h1>로그인</h1>
      <form onSubmit={onSubmit}>
        <label>이메일 <input name="email" type="email" required autoComplete="email" /></label>
        <label>비밀번호 <input name="password" type="password" required autoComplete="current-password" /></label>
        {error && <p role="alert">{error}</p>}
        <button type="submit" disabled={pending}>로그인</button>
      </form>
    </main>
  );
}
