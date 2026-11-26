import { DOMAIN_DOC_TITLES } from "./seed-data";

export type DomainDocSeed = { title: string; body: string };

/** `## <prefix>…` 절의 본문(다음 `## ` 전까지). */
function section(md: string, prefix: string): string {
  const lines = md.split("\n");
  const start = lines.findIndex((l) => l.startsWith(`## ${prefix}`));
  if (start < 0) throw new Error(`인수인계 문서에서 '${prefix}' 절을 찾지 못했어요.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("## "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n");
}

/** `### <heading>` 소절의 본문(다음 `### ` 전까지, 앞뒤 빈 줄 제거). */
function subsection(sectionMd: string, heading: string): string {
  const lines = sectionMd.split("\n");
  const start = lines.findIndex((l) => l.trim() === `### ${heading}`);
  if (start < 0) throw new Error(`인수인계 문서에서 '${heading}' 소제목을 찾지 못했어요.`);
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((l) => l.startsWith("### "));
  return (end < 0 ? rest : rest.slice(0, end)).join("\n").trim();
}

/** 2절(도메인 지식)의 소제목들과 5절의 '상태 전이'를 도메인 문서로 나눈다. 마크다운 `###` 제목으로 자른다. */
export function splitHandover(md: string): DomainDocSeed[] {
  const domain = section(md, "2.");
  const auth = section(md, "5.");
  const T = DOMAIN_DOC_TITLES;
  return [
    { title: T.glossary, body: subsection(domain, "용어집") },
    { title: T.format, body: subsection(domain, "요약 결과물의 형식") },
    { title: T.rules, body: subsection(domain, "도메인 규칙") },
    { title: T.decisions, body: subsection(domain, "제품 결정과 이유") },
    { title: T.open, body: subsection(domain, "아직 정하지 않은 것") },
    { title: T.states, body: subsection(auth, "상태 전이") },
  ];
}
