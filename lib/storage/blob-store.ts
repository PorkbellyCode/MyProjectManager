import { env } from "@/lib/env";

/**
 * 파일 저장소 추상화. 업로드 파일은 이 인터페이스로만 다룬다.
 * 저장소는 비공개이므로 `put`이 돌려주는 url은 앱 안의 경로(`/api/files/<key>`)다.
 * 마크다운에는 이 경로를 넣고, 읽을 때 /api/files 라우트가 로그인·멤버십을 검사한다.
 */
export interface StoredFile {
  stream: ReadableStream<Uint8Array>;
  contentType: string;
  size: number | null;
}

export interface BlobStore {
  put(key: string, data: Blob | ArrayBuffer, contentType: string): Promise<{ url: string }>;
  get(key: string): Promise<StoredFile | null>;
  delete(url: string): Promise<void>;
}

export const FILE_URL_PREFIX = "/api/files/";

export function fileUrlForKey(key: string): string {
  return `${FILE_URL_PREFIX}${key}`;
}

/** 앱 파일 경로(`/api/files/<key>`) 또는 키 자체에서 키를 꺼낸다. 형식이 맞지 않으면 null. */
export function keyFromUrl(urlOrKey: string): string | null {
  const key = urlOrKey.startsWith(FILE_URL_PREFIX) ? urlOrKey.slice(FILE_URL_PREFIX.length) : urlOrKey;
  return parseKey(key) ? key : null;
}

const KEY_RE = /^projects\/([0-9a-zA-Z_-]+)\/(\d{4})\/([0-9a-f-]{36})\.(png|jpg|gif|webp)$/;

/** `projects/<projectId>/<yyyy>/<uuid>.<ext>` 형식만 허용한다(경로 이탈 방지). */
export function parseKey(key: string): { projectId: string; year: string; ext: string } | null {
  const m = KEY_RE.exec(key);
  return m ? { projectId: m[1], year: m[2], ext: m[4] } : null;
}

export const IMAGE_TYPES: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

export const EXT_TO_TYPE: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

export function makeKey(projectId: string, ext: string, now: Date = new Date()): string {
  return `projects/${projectId}/${now.getUTCFullYear()}/${crypto.randomUUID()}.${ext}`;
}

let cached: BlobStore | null = null;

export async function getBlobStore(): Promise<BlobStore> {
  if (cached) return cached;
  if (env.MPM_FAKE_BLOB === "1") {
    const { createFakeBlobStore } = await import("./fake-blob");
    cached = createFakeBlobStore();
  } else {
    const { createVercelBlobStore } = await import("./vercel-blob");
    cached = createVercelBlobStore();
  }
  return cached;
}
