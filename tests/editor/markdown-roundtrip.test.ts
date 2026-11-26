// @vitest-environment jsdom
import { afterEach, describe, expect, test, vi } from "vitest";
import { Editor } from "@tiptap/core";
import { createExtensions } from "@/components/editor/extensions";
import { createUploadManager, isUploading, toMarkdown } from "@/components/editor/image-upload";
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from "@/lib/storage/limits";

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

  test("isUploading은 진행 중인 업로드가 있을 때만 true", async () => {
    URL.createObjectURL = vi.fn(() => "blob:http://x/1");
    URL.revokeObjectURL = vi.fn();
    const editor = makeEditor("");
    let finish!: (url: string) => void;
    const mgr = createUploadManager(() => new Promise<string>((r) => (finish = r)));
    mgr.attach(editor);
    mgr.insert(editor, [new File([new Uint8Array(4)], "a.png", { type: "image/png" })], null, () => {});
    expect(isUploading(editor)).toBe(true);
    finish("/api/files/x.png");
    await new Promise((r) => setTimeout(r, 0));
    expect(isUploading(editor)).toBe(false);
    editor.commands.setContent(doc([{ src: "/api/files/x.png" }]));
    expect(isUploading(editor)).toBe(false);
  });
});

describe("멈춘 업로드 상태 방지", () => {
  test("붙여넣은 HTML의 data-status/data-upload-id는 무시한다", () => {
    const editor = makeEditor("");
    editor.commands.setContent('<p>a</p><img data-status="uploading" data-upload-id="x" src="blob:http://x/1">', { contentType: "html" });
    expect(isUploading(editor)).toBe(false);
    expect(toMarkdown(editor)).not.toContain("blob:");
  });

  test("진행 중인 업로드 목록에 없는 uploading 노드는 세지 않는다", () => {
    const editor = makeEditor("");
    editor.commands.setContent({
      type: "doc",
      content: [{ type: "image", attrs: { src: "blob:http://x/1", uploadId: "ghost", status: "uploading" } }],
    });
    expect(isUploading(editor)).toBe(false);
  });
});

describe("업로드 오류 처리", () => {
  const announce = () => {};
  const setup = (upload: (f: File, p: string) => Promise<string>) => {
    URL.createObjectURL = vi.fn(() => "blob:http://x/" + Math.random());
    URL.revokeObjectURL = vi.fn();
    const editor = makeEditor("");
    const mgr = createUploadManager(upload);
    mgr.setProjectId("p1");
    mgr.attach(editor);
    return { editor, mgr };
  };
  const firstImage = (editor: Editor) => editor.state.doc.firstChild!.attrs;
  const png = (size = 10) => new File([new Uint8Array(size)], "a.png", { type: "image/png" });
  const tick = () => new Promise((r) => setTimeout(r, 0));

  test("4MB 초과는 요청 없이 다시 시도할 수 없는 실패가 된다", async () => {
    const upload = vi.fn(async () => "/api/files/x");
    const { editor, mgr } = setup(upload);
    mgr.insert(editor, [png(MAX_UPLOAD_BYTES + 1)], null, announce);
    await tick();
    expect(upload).not.toHaveBeenCalled();
    expect(firstImage(editor)).toMatchObject({ status: "failed", message: TOO_LARGE_MESSAGE });
    expect(isUploading(editor)).toBe(false);
    expect(toMarkdown(editor)).not.toContain("blob:");
  });

  test("서버 4xx는 서버 메시지로 실패하고 재시도하지 않는다, 5xx는 재시도 가능", async () => {
    const { UploadError } = await import("@/components/editor/image-upload");
    const upload = vi.fn().mockRejectedValueOnce(new UploadError("이 프로젝트가 아니에요.", false)).mockRejectedValueOnce(new Error("boom"));
    const a = setup(upload);
    a.mgr.insert(a.editor, [png()], null, announce);
    await tick();
    expect(firstImage(a.editor)).toMatchObject({ status: "failed", message: "이 프로젝트가 아니에요." });
    const b = setup(upload);
    b.mgr.insert(b.editor, [png()], null, announce);
    await tick();
    expect(firstImage(b.editor).status).toBe("failed");
    expect(firstImage(b.editor).message).toBeNull();
  });
});
