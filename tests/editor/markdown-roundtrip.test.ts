// @vitest-environment jsdom
import { afterEach, describe, expect, test } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@/components/editor/extensions";
import { isUploading, toMarkdown } from "@/components/editor/image-upload";

const editors: Editor[] = [];
function makeEditor(markdown: string) {
  const editor = new Editor({
    extensions: createExtensions({ placeholder: "", onFiles: () => {} }),
    content: markdown,
    contentType: "markdown",
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((e) => e.destroy()));

const roundTrip = (md: string) => toMarkdown(makeEditor(md));
const normalize = (s: string) => s.replace(/[ \t]+$/gm, "").replace(/\|\s*([^|\n]*?)\s*(?=\|)/g, "| $1 ").replace(/\|[\s:-]+(?=\|)/g, "|---").replace(/\n{3,}/g, "\n\n").trim();

describe("마크다운 왕복", () => {
  test("제목, 목록, 표, 코드, 이미지 보존", () => {
    const md = "# 제목\n\n- 항목\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x = 1\n```\n\n![shot](https://blob.example/x.png)\n";
    expect(normalize(roundTrip(md))).toBe(normalize(md));
  });
  test("앱 파일 경로 이미지도 그대로 보존", () => {
    const md = "![스크린샷](/api/files/projects/p1/2026/0b6f1f0e-0000-4000-8000-000000000000.png)";
    expect(normalize(roundTrip(md))).toBe(normalize(md));
  });
});

describe("업로드 상태", () => {
  const doc = (images: Array<{ src: string; uploadId?: string; status?: string }>) => ({
    type: "doc",
    content: [
      { type: "paragraph", content: [{ type: "text", text: "앞" }] },
      ...images.map((attrs) => ({ type: "image", attrs })),
      { type: "paragraph", content: [{ type: "text", text: "뒤" }] },
    ],
  });

  test("업로드 중/실패 이미지는 마크다운에 남지 않는다", () => {
    const editor = makeEditor("");
    editor.commands.setContent(
      doc([
        { src: "blob:http://x/1", uploadId: "a", status: "uploading" },
        { src: "blob:http://x/2", uploadId: "b", status: "failed" },
        { src: "https://blob.example/ok.png" },
      ]),
    );
    const md = toMarkdown(editor);
    expect(md).not.toContain("blob:");
    expect(md).toContain("![](https://blob.example/ok.png)");
    expect(md).toContain("앞");
    expect(md).toContain("뒤");
  });

  test("isUploading은 업로드 중일 때만 true", () => {
    const editor = makeEditor("");
    editor.commands.setContent(doc([{ src: "blob:http://x/1", uploadId: "a", status: "failed" }]));
    expect(isUploading(editor)).toBe(false);
    editor.commands.setContent(doc([{ src: "blob:http://x/1", uploadId: "a", status: "uploading" }]));
    expect(isUploading(editor)).toBe(true);
    editor.commands.setContent(doc([{ src: "/api/files/x.png" }]));
    expect(isUploading(editor)).toBe(false);
  });
});
