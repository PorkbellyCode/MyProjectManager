import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인" };

/** 이미 로그인했으면 앱으로 보낸다(/ 가 마지막 프로젝트로 다시 보낸다). */
export default function LoginPage() {
  return (
    <Suspense fallback={<main className="flex flex-1" aria-busy="true" />}>
      <SignedInRedirect />
    </Suspense>
  );
}

async function SignedInRedirect() {
  if (await getSessionUser()) redirect("/");
  return <LoginForm />;
}
