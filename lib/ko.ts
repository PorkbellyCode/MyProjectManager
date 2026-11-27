/**
 * 한국어 조사(이/가, 을/를, 은/는, 과/와, 으로/로)를 앞 말의 받침에 맞춰 붙인다.
 * 화면 문구에 동적인 이름(탭 이름, 상태, 사람 이름 등)을 끼울 때 쓴다. DB 접근 없음, 어디서나 import 가능.
 *
 *   josa("내 티켓", "이/가") → "내 티켓이"
 *   josa("내 요청", "이/가") → "내 요청이"
 *   josa("보통", "으로/로") → "보통으로", josa("서버", "으로/로") → "서버로", josa("레일", "으로/로") → "레일로"
 */
export type Josa = "이/가" | "을/를" | "은/는" | "과/와" | "으로/로";

const HANGUL_START = 0xac00;
const HANGUL_END = 0xd7a3;
/** ㄹ 받침의 종성 번호 */
const RIEUL = 8;

// 한글이 아닌 끝 글자를 읽을 때의 받침(숫자는 한자어 읽기, 영문은 흔한 발음 기준).
const DIGIT_JONG: Record<string, number> = { "0": 21, "1": RIEUL, "2": 0, "3": 16, "4": 0, "5": 0, "6": 1, "7": RIEUL, "8": RIEUL, "9": 0 };
const LATIN_JONG: Record<string, number> = { l: RIEUL, m: 16, n: 4, r: 0 };

/** 마지막 글자의 종성 번호(0 = 받침 없음). 판단할 수 없으면 null. */
export function finalConsonant(word: string): number | null {
  const trimmed = word.replace(/[\s)\]}"'’”.,!?~·…]+$/u, "");
  const ch = trimmed.at(-1);
  if (!ch) return null;
  const code = ch.charCodeAt(0);
  if (code >= HANGUL_START && code <= HANGUL_END) return (code - HANGUL_START) % 28;
  if (ch in DIGIT_JONG) return DIGIT_JONG[ch];
  const lower = ch.toLowerCase();
  if (/[a-z]/.test(lower)) return LATIN_JONG[lower] ?? 0;
  return null;
}

/** 조사만 돌려준다. 받침을 판단할 수 없으면 "이(가)"처럼 둘 다 보여 준다. */
export function particle(word: string, pair: Josa): string {
  const [withJong, withoutJong] = pair.split("/") as [string, string];
  const jong = finalConsonant(word);
  if (jong === null) return pair === "으로/로" ? "(으)로" : `${withJong}(${withoutJong})`;
  if (pair === "으로/로") return jong === 0 || jong === RIEUL ? "로" : "으로";
  return jong === 0 ? withoutJong : withJong;
}

/** 말 + 알맞은 조사. */
export function josa(word: string, pair: Josa): string {
  return `${word}${particle(word, pair)}`;
}
