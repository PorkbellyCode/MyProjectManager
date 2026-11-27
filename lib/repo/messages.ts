/** 분석 실패 스냅샷의 error("<code>: <message>")를 화면 문구로 바꾼다. */
const COPY: Record<string, string> = {
  not_found: "레포를 찾을 수 없어요",
  unauthorized: "토큰 권한을 확인해 주세요",
  rate_limited: "GitHub 요청 한도를 넘었어요. 잠시 뒤에 다시 분석해 주세요",
};

export function repoFailureText(error: string | null): string {
  const code = error?.split(":")[0]?.trim() ?? "";
  return COPY[code] ?? "분석 중 문제가 생겼어요. 잠시 뒤에 다시 분석해 주세요";
}

export const TRUNCATED_NOTICE = "레포가 커서 일부만 분석했어요.";
