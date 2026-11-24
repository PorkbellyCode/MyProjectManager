import { describe, expect, test } from "vitest";
import { decrypt, encrypt, parseKey } from "@/lib/crypto";

describe("crypto", () => {
  test("암호화 왕복, 저장값은 v1: 접두", () => {
    const e = encrypt("ghp_abc");
    expect(e.startsWith("v1:")).toBe(true);
    expect(e).not.toContain("ghp_abc");
    expect(decrypt(e)).toBe("ghp_abc");
  });
  test("같은 평문도 매번 다른 암호문", () => {
    expect(encrypt("x")).not.toBe(encrypt("x"));
  });
  test("변조된 값은 복호화 실패", () => {
    const e = encrypt("secret");
    const bad = e.slice(0, -2) + (e.endsWith("A") ? "BB" : "AA");
    expect(() => decrypt(bad)).toThrow();
  });
  test("알 수 없는 버전 접두는 거부", () => {
    expect(() => decrypt("v9:abc")).toThrow(/버전/);
  });
  test("키는 32바이트 base64여야 한다", () => {
    expect(() => parseKey("short")).toThrow(/32바이트/);
    expect(parseKey(Buffer.alloc(32, 1).toString("base64")).length).toBe(32);
  });
});
