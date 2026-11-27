import { describe, expect, test } from "vitest";
import { finalConsonant, josa, particle } from "@/lib/ko";

describe("josa", () => {
  test("이/가: 받침이 있으면 '이', 없으면 '가'", () => {
    expect(josa("내 티켓", "이/가")).toBe("내 티켓이");
    expect(josa("내 요청", "이/가")).toBe("내 요청이");
    expect(josa("내 그룹 큐", "이/가")).toBe("내 그룹 큐가");
    expect(josa("확인 대기", "이/가")).toBe("확인 대기가");
    expect(josa("전체", "이/가")).toBe("전체가");
  });
  test("을/를, 은/는, 과/와", () => {
    expect(josa("티켓", "을/를")).toBe("티켓을");
    expect(josa("레포", "을/를")).toBe("레포를");
    expect(josa("형준", "은/는")).toBe("형준은");
    expect(josa("서버", "과/와")).toBe("서버와");
  });
  test("으로/로: 받침 없음·ㄹ 받침은 '로'", () => {
    expect(josa("보통", "으로/로")).toBe("보통으로");
    expect(josa("낮음", "으로/로")).toBe("낮음으로");
    expect(josa("서버", "으로/로")).toBe("서버로");
    expect(josa("종결", "으로/로")).toBe("종결로");
    expect(josa("정상 동작", "으로/로")).toBe("정상 동작으로");
  });
  test("숫자·영문·괄호로 끝나는 말", () => {
    expect(josa("v2", "이/가")).toBe("v2가");
    expect(josa("v3", "이/가")).toBe("v3이");
    expect(josa("sample-repo", "을/를")).toBe("sample-repo를");
    expect(josa("철회(AI 해소)", "으로/로")).toBe("철회(AI 해소)로");
    expect(josa("Gemini", "이/가")).toBe("Gemini가");
  });
  test("판단할 수 없으면 둘 다 보여 준다", () => {
    expect(finalConsonant("")).toBeNull();
    expect(particle("★", "이/가")).toBe("이(가)");
    expect(particle("★", "으로/로")).toBe("(으)로");
  });
});
