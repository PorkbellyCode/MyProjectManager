import type { Editor, Extensions } from "@tiptap/core";
import FileHandler from "@tiptap/extension-file-handler";
import { TableKit } from "@tiptap/extension-table";
import { Markdown } from "@tiptap/markdown";
import { Placeholder } from "@tiptap/extensions";
import StarterKit from "@tiptap/starter-kit";
import { ALLOWED_IMAGE_TYPES, UploadableImage } from "./image-upload";

export function createExtensions(opts: {
  placeholder?: string;
  onFiles: (editor: Editor, files: File[], pos: number | null) => void;
  onRetry?: (uploadId: string) => void;
}): Extensions {
  return [
    StarterKit.configure({ link: { openOnClick: false } }),
    Markdown,
    TableKit.configure({ table: { resizable: false } }),
    UploadableImage.configure({ onRetry: opts.onRetry }),
    FileHandler.configure({
      allowedMimeTypes: ALLOWED_IMAGE_TYPES,
      consumePasteEvent: true,
      onPaste: (editor, files) => opts.onFiles(editor, files, null),
      onDrop: (editor, files, pos) => opts.onFiles(editor, files, pos),
    }),
    Placeholder.configure({ placeholder: opts.placeholder ?? "" }),
  ];
}
