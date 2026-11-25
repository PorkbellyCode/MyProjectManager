import type { Db } from "@/lib/db";
import { getMembership } from "@/lib/access";
import { MAX_UPLOAD_BYTES, TOO_LARGE_MESSAGE } from "./limits";
import { IMAGE_TYPES, makeKey, type BlobStore } from "./blob-store";

export { MAX_UPLOAD_BYTES };

// multipart 경계·필드가 차지하는 여유분. 본문을 읽기 전에 이보다 크면 바로 거절한다.
const MULTIPART_OVERHEAD = 64 * 1024;

export type UploadDeps = {
  db: Db;
  store: BlobStore;
  getUser: () => Promise<{ id: string } | null>;
};

function fail(status: number, error: string, message: string): Response {
  return Response.json({ error, message }, { status });
}

/** POST /api/uploads — multipart `file`, `projectId`. 응답 `{ url }`. */
export async function handleUpload(request: Request, deps: UploadDeps): Promise<Response> {
  const user = await deps.getUser();
  if (!user) return fail(401, "unauthorized", "로그인이 필요해요.");

  const declared = Number(request.headers.get("content-length"));
  if (Number.isFinite(declared) && declared > MAX_UPLOAD_BYTES + MULTIPART_OVERHEAD) {
    return fail(413, "too_large", TOO_LARGE_MESSAGE);
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return fail(400, "bad_request", "올바른 업로드 요청이 아니에요.");
  }
  const projectId = form.get("projectId");
  const file = form.get("file");
  if (typeof projectId !== "string" || !projectId || !(file instanceof Blob)) {
    return fail(400, "bad_request", "파일과 프로젝트가 필요해요.");
  }

  const membership = await getMembership(deps.db, projectId, user.id).catch(() => null);
  if (!membership) return fail(404, "not_found", "찾을 수 없어요.");

  const ext = IMAGE_TYPES[file.type];
  if (!ext) return fail(415, "unsupported_type", "PNG, JPEG, GIF, WebP 이미지만 올릴 수 있어요.");
  if (file.size > MAX_UPLOAD_BYTES) return fail(413, "too_large", TOO_LARGE_MESSAGE);

  const key = makeKey(projectId, ext);
  const { url } = await deps.store.put(key, await file.arrayBuffer(), file.type);
  return Response.json({ url }, { status: 201 });
}
