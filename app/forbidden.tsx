import Link from "next/link";
import { AuthFrame } from "@/components/app-shell/auth-frame";

export default function Forbidden() {
  return (
    <AuthFrame title="권한이 없어요" description="이 화면은 프로젝트 리드만 볼 수 있어요.">
      <Link href="/" className="text-sm underline underline-offset-4">
        처음으로 돌아가기
      </Link>
    </AuthFrame>
  );
}
