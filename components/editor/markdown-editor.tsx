"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import type { Editor } from "@tiptap/core";
import { EditorContent, useEditor, useEditorState } from "@tiptap/react";
import { Bold, Code, Heading2, ImagePlus, Italic, List, ListOrdered, Quote, SquareCode } from "lucide-react";
import { cn } from "@/lib/utils";
import { createExtensions } from "./extensions";
import { ALLOWED_IMAGE_TYPES, createUploadManager, isUploading, toMarkdown } from "./image-upload";

export { isUploading, toMarkdown } from "./image-upload";

export type MarkdownEditorProps = {
  /** 처음 보여줄 마크다운. 이후 바깥에서 다른 값으로 바뀌면 내용을 교체한다. */
  value: string;
  onChange: (markdown: string) => void;
  projectId: string;
  placeholder?: string;
  minHeight?: number;
  /** 화면 읽기 프로그램용 이름. */
  label?: string;
  /** 업로드 중 여부가 바뀔 때(제출 버튼 비활성에 쓴다). */
  onUploadingChange?: (uploading: boolean) => void;
  onReady?: (editor: Editor) => void;
  className?: string;
};

type ToolbarItem = {
  label: string;
  icon: typeof Bold;
  isActive: (e: Editor) => boolean;
  run: (e: Editor) => void;
};

const TOOLBAR: ToolbarItem[] = [
  { label: "굵게", icon: Bold, isActive: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "기울임", icon: Italic, isActive: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: "제목", icon: Heading2, isActive: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "글머리 목록", icon: List, isActive: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "번호 목록", icon: ListOrdered, isActive: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "인용", icon: Quote, isActive: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "코드", icon: Code, isActive: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  { label: "코드 블록", icon: SquareCode, isActive: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
];

export function MarkdownEditor({
  value,
  onChange,
  projectId,
  placeholder,
  minHeight = 160,
  label = "내용",
  onUploadingChange,
  onReady,
  className,
}: MarkdownEditorProps) {
  const statusId = useId();
  const fileInput = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState("");

  // 콜백과 projectId는 ref로 들고, 에디터는 한 번만 만든다.
  const [uploads] = useState(() => createUploadManager());
  const latest = useRef({ onChange, onUploadingChange, onReady, projectId });
  useEffect(() => {
    latest.current = { onChange, onUploadingChange, onReady, projectId };
    uploads.setProjectId(projectId);
  });
  const lastEmitted = useRef(value);
  const lastUploading = useRef(false);

  const extensions = useMemo(
    () =>
      createExtensions({
        placeholder,
        onFiles: (editor, files, pos) => {
          uploads.insert(editor, files, pos, setStatus);
        },
        onRetry: (uploadId) => uploads.retry(uploadId, setStatus),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 확장은 처음 한 번만 만든다.
    [uploads],
  );

  const editor = useEditor({
    extensions,
    content: value,
    contentType: "markdown",
    immediatelyRender: false,
    editorProps: {
      attributes: {
        role: "textbox",
        "aria-multiline": "true",
        "aria-label": label,
        class: "mpm-prose",
        style: `min-height:${minHeight}px`,
      },
    },
    onCreate: ({ editor }) => {
      uploads.attach(editor);
      latest.current.onReady?.(editor);
    },
    onUpdate: ({ editor }) => {
      const md = toMarkdown(editor);
      if (md !== lastEmitted.current) {
        lastEmitted.current = md;
        latest.current.onChange(md);
      }
      const uploading = isUploading(editor);
      if (uploading !== lastUploading.current) {
        lastUploading.current = uploading;
        latest.current.onUploadingChange?.(uploading);
      }
    },
  });

  // 바깥에서 값이 바뀐 경우(예: 초안 불러오기)만 내용을 교체한다.
  useEffect(() => {
    if (!editor || value === lastEmitted.current) return;
    lastEmitted.current = value;
    editor.commands.setContent(value, { contentType: "markdown", emitUpdate: false });
  }, [editor, value]);

  useEffect(() => () => uploads.dispose(), [uploads]);

  const active = useEditorState({
    editor,
    selector: ({ editor: e }) => (e ? TOOLBAR.map((t) => t.isActive(e)) : []),
  });

  return (
    <div
      className={cn(
        "rounded-[10px] border border-line bg-surface transition-[border-color,box-shadow] duration-[120ms] focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30",
        className,
      )}
    >
      <div role="toolbar" aria-label="서식" className="flex flex-wrap items-center gap-1 border-b border-line px-2 py-1.5">
        {TOOLBAR.map((item, i) => (
          <button
            key={item.label}
            type="button"
            aria-label={item.label}
            aria-pressed={active?.[i] ?? false}
            title={item.label}
            disabled={!editor}
            onClick={() => editor && item.run(editor)}
            className="inline-flex size-8 items-center justify-center rounded-md text-muted-text outline-none transition-colors hover:bg-sunken hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/50 aria-pressed:bg-sunken aria-pressed:text-text disabled:opacity-50"
          >
            <item.icon className="size-4" aria-hidden />
          </button>
        ))}
        <button
          type="button"
          aria-label="이미지 첨부"
          title="이미지 첨부"
          disabled={!editor}
          onClick={() => fileInput.current?.click()}
          className="inline-flex size-8 items-center justify-center rounded-md text-muted-text outline-none transition-colors hover:bg-sunken hover:text-text focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:opacity-50"
        >
          <ImagePlus className="size-4" aria-hidden />
        </button>
        <input
          ref={fileInput}
          type="file"
          accept={ALLOWED_IMAGE_TYPES.join(",")}
          multiple
          hidden
          data-testid="editor-file-input"
          onChange={(e) => {
            if (editor && e.target.files) uploads.insert(editor, [...e.target.files], null, setStatus);
            e.target.value = "";
          }}
        />
      </div>
      <EditorContent editor={editor} className="px-4 py-3" aria-describedby={statusId} />
      <p id={statusId} role="status" aria-live="polite" className="min-h-0 px-4 pb-2 text-xs text-faint empty:hidden">
        {status}
      </p>
    </div>
  );
}
