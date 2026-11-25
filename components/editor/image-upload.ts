import type { Editor, JSONContent } from "@tiptap/core";
import Image from "@tiptap/extension-image";
import type { Node as PMNode } from "@tiptap/pm/model";

export const RETRY_LABEL = "업로드 실패, 다시 시도";
export const UPLOADING_LABEL = "업로드 중…";

export type UploadStatus = "uploading" | "failed";

/** 이미지 노드에 업로드 상태(`data-upload-id`, `data-status`)를 싣고, 실패하면 다시 시도 버튼을 보여준다. */
export const UploadableImage = Image.extend<{ onRetry?: (uploadId: string) => void }>({
  addOptions() {
    return { ...this.parent?.(), onRetry: undefined };
  },
  addAttributes() {
    return {
      ...this.parent?.(),
      uploadId: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-upload-id"),
        renderHTML: (a) => (a.uploadId ? { "data-upload-id": a.uploadId } : {}),
      },
      status: {
        default: null,
        parseHTML: (el) => el.getAttribute("data-status"),
        renderHTML: (a) => (a.status ? { "data-status": a.status } : {}),
      },
    };
  },
  addNodeView() {
    const onRetry = this.options.onRetry;
    return ({ node }) => {
      const dom = document.createElement("div");
      dom.className = "mpm-image";
      dom.contentEditable = "false";
      const img = document.createElement("img");
      img.draggable = false;
      dom.appendChild(img);
      let overlay: HTMLElement | null = null;

      const render = (n: PMNode) => {
        const { src, alt, title, uploadId, status } = n.attrs as Record<string, string | null>;
        img.src = src ?? "";
        img.alt = alt ?? "";
        if (title) img.title = title;
        else img.removeAttribute("title");
        for (const [name, value] of [
          ["data-upload-id", uploadId],
          ["data-status", status],
        ] as const) {
          if (value) img.setAttribute(name, value);
          else img.removeAttribute(name);
        }
        dom.dataset.status = status ?? "";
        overlay?.remove();
        overlay = null;
        if (status === "failed") {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "mpm-image-retry";
          button.textContent = RETRY_LABEL;
          button.addEventListener("click", (e) => {
            e.preventDefault();
            if (uploadId) onRetry?.(uploadId);
          });
          overlay = button;
        } else if (status === "uploading") {
          const label = document.createElement("span");
          label.className = "mpm-image-uploading";
          label.textContent = UPLOADING_LABEL;
          overlay = label;
        }
        if (overlay) dom.appendChild(overlay);
      };
      render(node);

      return {
        dom,
        update(n) {
          if (n.type !== node.type) return false;
          render(n);
          return true;
        },
        stopEvent: (e) => e.target instanceof HTMLElement && e.target.closest("button") !== null,
      };
    };
  },
});

function statusOf(node: { type?: string; attrs?: Record<string, unknown> }): string | null {
  if (node.type !== "image") return null;
  const s = node.attrs?.status;
  return typeof s === "string" ? s : null;
}

/** 업로드 중인 이미지가 있으면 true. 제출 버튼을 막는 데 쓴다. */
export function isUploading(editor: Editor): boolean {
  let found = false;
  editor.state.doc.descendants((node) => {
    if (node.type.name === "image" && node.attrs.status === "uploading") found = true;
    return !found;
  });
  return found;
}

function stripPending(node: JSONContent): JSONContent | null {
  const s = statusOf(node);
  if (s === "uploading" || s === "failed") return null;
  if (!node.content) return node;
  return { ...node, content: node.content.map(stripPending).filter((n): n is JSONContent => n !== null) };
}

/** 마크다운으로 내보낸다. 업로드 중이거나 실패한 이미지(blob: 미리보기)는 넣지 않는다. */
export function toMarkdown(editor: Editor): string {
  const doc = stripPending(editor.getJSON()) ?? { type: "doc", content: [] };
  return editor.markdown ? editor.markdown.serialize(doc) : "";
}

export const ALLOWED_IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

export async function uploadImage(file: File, projectId: string): Promise<string> {
  const form = new FormData();
  form.set("file", file);
  form.set("projectId", projectId);
  const res = await fetch("/api/uploads", { method: "POST", body: form });
  if (!res.ok) throw new Error(`upload failed: ${res.status}`);
  const data = (await res.json()) as { url?: unknown };
  if (typeof data.url !== "string") throw new Error("upload failed: no url");
  return data.url;
}

type Pending = { file: File; objectUrl: string };

/** 붙여넣기/드롭한 이미지의 미리보기 노드, 업로드, 결과 반영을 맡는다. */
export function createUploadManager(upload = uploadImage) {
  const pending = new Map<string, Pending>();
  let projectId = "";
  let attached: Editor | null = null;

  function update(editor: Editor, uploadId: string, attrs: Record<string, unknown>): boolean {
    let pos = -1;
    editor.state.doc.descendants((node, p) => {
      if (pos < 0 && node.type.name === "image" && node.attrs.uploadId === uploadId) pos = p;
      return pos < 0;
    });
    if (pos < 0) return false;
    const node = editor.state.doc.nodeAt(pos)!;
    const tr = editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, ...attrs });
    tr.setMeta("addToHistory", false);
    editor.view.dispatch(tr);
    return true;
  }

  function release(uploadId: string) {
    const p = pending.get(uploadId);
    if (p) URL.revokeObjectURL(p.objectUrl);
    pending.delete(uploadId);
  }

  async function run(editor: Editor, uploadId: string, announce: (msg: string) => void) {
    const p = pending.get(uploadId);
    if (!p) return;
    try {
      const url = await upload(p.file, projectId);
      if (editor.isDestroyed) return release(uploadId);
      // 올리는 사이 사용자가 이미지를 지웠으면 결과만 버린다.
      update(editor, uploadId, { src: url, uploadId: null, status: null });
      release(uploadId);
      announce("이미지를 올렸어요.");
    } catch {
      if (editor.isDestroyed) return release(uploadId);
      if (update(editor, uploadId, { status: "failed" })) announce("이미지 업로드에 실패했어요. 다시 시도할 수 있어요.");
      else release(uploadId);
    }
  }

  return {
    setProjectId(id: string) {
      projectId = id;
    },
    attach(editor: Editor | null) {
      attached = editor;
    },
    /** 미리보기 노드를 넣고 업로드를 시작한다. pos가 없으면 현재 선택 위치. */
    insert(editor: Editor, files: File[], pos: number | null, announce: (msg: string) => void) {
      const images = files.filter((f) => ALLOWED_IMAGE_TYPES.includes(f.type));
      let at = pos ?? editor.state.selection.to;
      for (const file of images) {
        const uploadId = crypto.randomUUID();
        const objectUrl = URL.createObjectURL(file);
        pending.set(uploadId, { file, objectUrl });
        const alt = file.name && file.name !== "image.png" ? file.name.replace(/\.[^.]+$/, "") : "스크린샷";
        editor
          .chain()
          .insertContentAt(at, { type: "image", attrs: { src: objectUrl, alt, uploadId, status: "uploading" } })
          .run();
        at = editor.state.selection.to;
        announce("이미지 업로드 중…");
        void run(editor, uploadId, announce);
      }
      return images.length;
    },
    retry(uploadId: string, announce: (msg: string) => void) {
      const editor = attached;
      if (!editor || !pending.has(uploadId)) return;
      update(editor, uploadId, { status: "uploading" });
      announce("이미지 업로드 중…");
      void run(editor, uploadId, announce);
    },
    dispose() {
      for (const id of [...pending.keys()]) release(id);
    },
  };
}
