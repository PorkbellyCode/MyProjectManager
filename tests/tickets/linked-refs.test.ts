import { describe, expect, test } from "vitest";
import { InvalidLinkedRefError, MAX_LINKED_REFS, normalizeLinkedRef, parseLinkedRefs, refsFromForm } from "@/lib/tickets/linked-refs";
import { linkedRefsSchema, resolveFormSchema, resolveSchema } from "@/app/p/[projectId]/tickets/schemas";

const UUID = "3f2b8c1e-9d4a-4b6f-8e2a-1c5d7f9a0b3e";

describe("linked refs", () => {
  test("허용 형식만 정규화한다(SHA·uuid 소문자, PR 앞자리 0 제거)", () => {
    expect(normalizeLinkedRef("pr:12")).toBe("pr:12");
    expect(normalizeLinkedRef(" pr:0042 ")).toBe("pr:42");
    expect(normalizeLinkedRef("commit:ABCDEF1")).toBe("commit:abcdef1");
    expect(normalizeLinkedRef(`commit:${"a".repeat(40)}`)).toBe(`commit:${"a".repeat(40)}`);
    expect(normalizeLinkedRef(`ticket:${UUID.toUpperCase()}`)).toBe(`ticket:${UUID}`);
  });

  test.each([
    "pr:",
    "pr:12345678",
    "pr:1a",
    "commit:abc12",
    `commit:${"a".repeat(41)}`,
    "commit:ghijklm",
    "ticket:12",
    "ticket:../../x",
    "javascript:alert(1)",
    "https://evil.example",
    "12",
  ])("거부: %s", (raw) => {
    expect(normalizeLinkedRef(raw)).toBeNull();
    expect(() => parseLinkedRefs([raw])).toThrow(InvalidLinkedRefError);
  });

  test("빈 칸은 버리고 중복은 합친다", () => {
    expect(parseLinkedRefs(["pr:12", " ", "PR:12", "commit:ABCDEF1", "commit:abcdef1"])).toEqual(["pr:12", "commit:abcdef1"]);
    expect(parseLinkedRefs(undefined)).toEqual([]);
  });

  test(`최대 ${MAX_LINKED_REFS}개`, () => {
    const ten = Array.from({ length: MAX_LINKED_REFS }, (_, i) => `pr:${i + 1}`);
    expect(parseLinkedRefs(ten)).toHaveLength(MAX_LINKED_REFS);
    expect(() => parseLinkedRefs([...ten, "pr:99"])).toThrow(/10개까지/);
  });

  test("형식별 한국어 안내", () => {
    expect(() => parseLinkedRefs(["pr:x"])).toThrow("PR 번호는 숫자 7자리 이하로 적어 주세요.");
    expect(() => parseLinkedRefs(["commit:zz"])).toThrow("커밋 SHA는 7~40자리 16진수로 적어 주세요.");
  });

  test("액션 스키마도 같은 규칙으로 거른다", () => {
    expect(resolveSchema.safeParse({ expectedVersion: 1, linkedRefs: ["pr:12", `ticket:${UUID}`] }).success).toBe(true);
    expect(resolveSchema.safeParse({ expectedVersion: 1 }).success).toBe(true);
    expect(linkedRefsSchema.safeParse(["javascript:alert(1)"]).success).toBe(false);
    expect(linkedRefsSchema.safeParse(Array.from({ length: 11 }, (_, i) => `pr:${i}`)).success).toBe(false);
  });

  test("화면 입력 → 참조", () => {
    expect(refsFromForm({ pr: "#42", commits: "abc1234, DEF5678  9876543" })).toEqual(["pr:42", "commit:abc1234", "commit:DEF5678", "commit:9876543"]);
    expect(refsFromForm({ pr: "", commits: "" })).toEqual([]);
    expect(resolveFormSchema.safeParse({ pr: "12", commits: "abc1234" }).success).toBe(true);
    expect(resolveFormSchema.safeParse({ pr: "12a", commits: "" }).success).toBe(false);
    expect(resolveFormSchema.safeParse({ pr: "", commits: "xyz" }).success).toBe(false);
  });
});
