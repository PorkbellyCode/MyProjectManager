import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { AuthFrameSkeleton } from "@/components/app-shell/auth-frame";
import { LoginForm } from "./login-form";

export const metadata = { title: "로그인" };

/** 이미 로그인했으면 앱으로 보낸다(/ 가 마지막 프로젝트로 다시 보낸다). */
export default function LoginPage() {
  return (
    <Suspense fallback={<LoginSkeleton />}>
      <SignedInRedirect />
    </Suspense>
  );
}

async function SignedInRedirect() {
  if (await getSessionUser()) redirect("/");
  return <LoginForm />;
}

function LoginSkeleton() {
  return <AuthFrameSkeleton title="로그인" description="요청을 보내고 처리 상황을 확인하려면 로그인해 주세요." />;
}
