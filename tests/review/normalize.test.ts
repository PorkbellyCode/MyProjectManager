import { describe, expect, test } from "vitest";
import { normalizeDedup, normalizeResolve, validEvidence, type EvidenceCtx } from "@/lib/review/normalize";

const ctx: EvidenceCtx = {
  ticketIds: new Map([
    ["t-resolved", { status: "closed", closeReason: "resolved_confirmed" }],
    ["t-wont", { status: "closed", closeReason: "wont_do" }],
    ["t-open", { status: "queued", closeReason: null }],
    ["t-draft", { status: "draft", closeReason: null }],
    ["t-withdrawn", { status: "withdrawn_ai_resolved", closeReason: null }],
    ["t-self", { status: "queued", closeReason: null }],
    ["t-a", { status: "queued", closeReason: null }],
    ["t-b", { status: "assigned", closeReason: null }],
    ["t-c", { status: "in_progress", closeReason: null }],
  ]),
  commitShas: new Set(["abcdef1234567890", "abcdef9999999999"]),
  prNumbers: new Set([12]),
  docIds: new Set(["d1"]),
};
const ev = (ref: string) => ({ ref, note: "n" });

describe("validEvidence", () => {
  test("형식 오류, 없는 대상, 다른 프로젝트 ref는 제거한다", () => {
    const out = validEvidence(
      [ev("ticket:t-open"), ev("ticket:other-proj"), ev("commit:nope"), ev("pr:12"), ev("pr:13"), ev("doc:d1"), ev("doc:zz"), ev("bogus"), ev("pr:12x"), ev("ticket:")],
      ctx,
    );
    expect(out.map((e) => e.ref)).toEqual(["ticket:t-open", "pr:12", "doc:d1"]);
  });
  test("커밋은 정확히 일치하거나 7자 이상 접두가 모호하지 않을 때만 허용", () => {
    expect(validEvidence([ev("commit:abcdef1234567890")], ctx)).toHaveLength(1);
    expect(validEvidence([ev("commit:abcdef1")], ctx)).toHaveLength(1);
    expect(validEvidence([ev("commit:abcdef9")], ctx)).toHaveLength(1);
    expect(validEvidence([ev("commit:abcdef")], ctx)).toHaveLength(0); // 6자
    expect(validEvidence([ev("commit:abcdef")], { ...ctx, commitShas: new Set(["abcdef"]) })).toHaveLength(1); // 정확 일치
    expect(validEvidence([ev("commit:abcdef")], { ...ctx, commitShas: new Set(["abcdef", "abcdef0"]) })).toHaveLength(1);
    const ambiguous = { ...ctx, commitShas: new Set(["abcdef1111", "abcdef1222"]) };
    expect(validEvidence([ev("commit:abcdef1")], ambiguous)).toHaveLength(0);
  });
});

describe("normalizeResolve", () => {
  test("다른 프로젝트 티켓·없는 커밋 근거는 제거되고, 남는 게 없으면 null", () => {
    expect(
      normalizeResolve(
        { kind: "already_resolved", message: "해결됐어요", evidence: [{ ref: "ticket:other-proj", note: "" }, { ref: "commit:nope", note: "" }] },
        ctx,
      ),
    ).toBeNull();
  });
  test("none이면 null", () => {
    expect(normalizeResolve({ kind: "none", message: "", evidence: [ev("ticket:t-resolved")] }, ctx)).toBeNull();
  });
  test("resolved_confirmed 티켓 근거가 있으면 strong, 접두 없음", () => {
    const r = normalizeResolve({ kind: "already_resolved", message: "해결됐어요", evidence: [ev("ticket:t-resolved"), ev("commit:abcdef1")] }, ctx);
    expect(r).toMatchObject({ kind: "already_resolved", strength: "strong", message: "해결됐어요" });
    expect(r?.evidence).toHaveLength(2);
  });
  test("커밋 근거만 있는 already_resolved는 weak + 접두", () => {
    const r = normalizeResolve({ kind: "already_resolved", message: "고쳐졌어요", evidence: [ev("commit:abcdef1234567890")] }, ctx);
    expect(r).toMatchObject({ strength: "weak", message: "관련 변경이 있었던 것으로 보여요. 고쳐졌어요" });
  });
  test("resolved_confirmed가 아닌 티켓 근거만 있으면 weak", () => {
    const r = normalizeResolve({ kind: "already_resolved", message: "m", evidence: [ev("ticket:t-wont")] }, ctx);
    expect(r?.strength).toBe("weak");
    expect(r?.message.startsWith("관련 변경이 있었던 것으로 보여요. ")).toBe(true);
  });
  test("도메인 지식 근거 없는 expected_behavior → null", () => {
    expect(normalizeResolve({ kind: "expected_behavior", message: "의도예요", evidence: [ev("commit:abcdef1"), ev("ticket:t-open")] }, ctx)).toBeNull();
  });
  test("doc 근거가 있는 expected_behavior는 통과", () => {
    const r = normalizeResolve({ kind: "expected_behavior", message: "의도예요", evidence: [ev("doc:d1"), ev("doc:zz")] }, ctx);
    expect(r).toMatchObject({ kind: "expected_behavior", strength: "strong", evidence: [{ ref: "doc:d1", note: "n" }] });
  });
});

describe("normalizeDedup", () => {
  test("중복 후보: 철회·초안·자기 자신·없는 티켓 제외, 중복 제거, 최대 3", () => {
    const out = normalizeDedup(
      {
        candidates: [
          { ticketId: "t-withdrawn", reason: "" },
          { ticketId: "t-draft", reason: "" },
          { ticketId: "t-self", reason: "" },
          { ticketId: "nope", reason: "" },
          { ticketId: "t-a", reason: "a" },
          { ticketId: "t-a", reason: "dup" },
          { ticketId: "t-b", reason: "b" },
          { ticketId: "t-c", reason: "c" },
          { ticketId: "t-open", reason: "d" },
        ],
      },
      ctx,
      "t-self",
    );
    expect(out.candidates.map((c) => c.ticketId)).toEqual(["t-a", "t-b", "t-c"]);
  });
});
