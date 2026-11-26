/**
 * 처리 완료(resolve)에 링크하는 참조의 형식 검사. 서버 액션과 서비스가 같이 쓴다(DB 접근 없음).
 * 허용: `pr:<1~7자리 숫자>`, `commit:<7~40자리 16진수>`(소문자로 맞춘다), `ticket:<uuid>`. 최대 10개.
 */

export const MAX_LINKED_REFS = 10;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class InvalidLinkedRefError extends Error {
  constructor(message = "PR 번호나 커밋 SHA 형식이 올바르지 않아요.") {
    super(message);
    this.name = "InvalidLinkedRefError";
  }
}

/** 참조 하나를 정규화한다. 형식이 맞지 않으면 null. */
export function normalizeLinkedRef(raw: string): string | null {
  const s = raw.trim();
  const i = s.indexOf(":");
  if (i <= 0) return null;
  const kind = s.slice(0, i).toLowerCase();
  const value = s.slice(i + 1).trim();
  if (kind === "pr") return /^\d{1,7}$/.test(value) ? `pr:${Number(value)}` : null;
  if (kind === "commit") return /^[0-9a-f]{7,40}$/i.test(value) ? `commit:${value.toLowerCase()}` : null;
  if (kind === "ticket") return UUID_RE.test(value) ? `ticket:${value.toLowerCase()}` : null;
  return null;
}

/**
 * 참조 목록을 검사하고 정규화한다. 빈 칸은 버리고 중복은 하나로 합친다.
 * 형식이 틀린 항목이 있거나 10개를 넘으면 InvalidLinkedRefError.
 */
export function parseLinkedRefs(input: readonly string[] | undefined | null): string[] {
  const out: string[] = [];
  for (const raw of input ?? []) {
    if (typeof raw !== "string") throw new InvalidLinkedRefError();
    if (!raw.trim()) continue;
    const ref = normalizeLinkedRef(raw);
    if (!ref) throw new InvalidLinkedRefError(refMessage(raw.trim()));
    if (!out.includes(ref)) out.push(ref);
  }
  if (out.length > MAX_LINKED_REFS) throw new InvalidLinkedRefError(`관련 변경은 ${MAX_LINKED_REFS}개까지 링크할 수 있어요.`);
  return out;
}

function refMessage(raw: string): string {
  const kind = raw.slice(0, Math.max(0, raw.indexOf(":"))).toLowerCase();
  if (kind === "pr") return "PR 번호는 숫자 7자리 이하로 적어 주세요.";
  if (kind === "commit") return "커밋 SHA는 7~40자리 16진수로 적어 주세요.";
  if (kind === "ticket") return "티켓 참조가 올바르지 않아요.";
  return "PR 번호나 커밋 SHA 형식이 올바르지 않아요.";
}

/** 화면 입력(PR 번호, 커밋 SHA 여러 개)을 참조 목록으로 바꾼다. "#12"처럼 적어도 받는다. 검사는 parseLinkedRefs가 한다. */
export function refsFromForm(input: { pr?: string; commits?: string }): string[] {
  const refs: string[] = [];
  const pr = input.pr?.trim().replace(/^#/, "");
  if (pr) refs.push(`pr:${pr}`);
  for (const c of (input.commits ?? "").split(/[\s,]+/)) if (c.trim()) refs.push(`commit:${c.trim()}`);
  return refs;
}
