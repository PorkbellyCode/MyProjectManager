import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, test, vi } from "vitest";
import { createTestDb } from "./helpers/db";
import { addMember, makeProject, signUp } from "./helpers/world";
import { createAuth } from "@/lib/auth";
import type { Db } from "@/lib/db";
import { fileUrlForKey, keyFromUrl, makeKey, parseKey } from "@/lib/storage/blob-store";
import { createFakeBlobStore } from "@/lib/storage/fake-blob";
import { handleUpload, MAX_UPLOAD_BYTES } from "@/lib/storage/upload";

const { putMock, getMock, delMock } = vi.hoisted(() => ({
  putMock: vi.fn(async () => ({})),
  getMock: vi.fn(),
  delMock: vi.fn(async () => undefined),
}));
vi.mock("@vercel/blob", () => ({ put: putMock, get: getMock, del: delMock }));

let db: Db;
let close: () => Promise<void>;
let projectId: string;
let member: { id: string }, outsider: { id: string };
let root: string;

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

beforeAll(async () => {
  ({ db, close } = await createTestDb());
  const auth = createAuth(db);
  const lead = await signUp(auth, "lead@example.com", "리드");
  member = await signUp(auth, "dev@example.com", "개발자");
  outsider = await signUp(auth, "out@example.com", "외부인");
  const p = await makeProject(db, auth, "demo", lead.id);
  await addMember(auth, p.orgId, member.id, "developer");
  projectId = p.project.id;
  root = await fs.mkdtemp(path.join(os.tmpdir(), "mpm-blob-"));
});
afterAll(async () => {
  await close();
  await fs.rm(root, { recursive: true, force: true });
});

function upload(user: { id: string } | null, form: FormData, headers: Record<string, string> = {}) {
  const store = createFakeBlobStore(root);
  const req = new Request("http://localhost/api/uploads", { method: "POST", body: form, headers });
  return handleUpload(req, { db, store, getUser: async () => user });
}
function formWith(type: string, bytes: Uint8Array | ArrayBuffer, pid = projectId) {
  const f = new FormData();
  f.set("file", new File([bytes as BlobPart], "shot", { type }));
  f.set("projectId", pid);
  return f;
}

describe("파일 키", () => {
  test("키 형식과 앱 URL 변환", () => {
    const key = makeKey("proj_1", "png", new Date("2026-03-01T00:00:00Z"));
    expect(key).toMatch(/^projects\/proj_1\/2026\/[0-9a-f-]{36}\.png$/);
    expect(parseKey(key)?.projectId).toBe("proj_1");
    expect(keyFromUrl(fileUrlForKey(key))).toBe(key);
    expect(fileUrlForKey(key)).toBe(`/api/files/${key}`);
  });
  test("경로 이탈·잘못된 키는 거절", () => {
    expect(parseKey("projects/p/2026/../../etc/passwd")).toBeNull();
    expect(parseKey("projects/p/2026/x.png")).toBeNull();
    expect(keyFromUrl("https://blob.example/x.png")).toBeNull();
  });
});

describe("가짜 저장소", () => {
  test("put → get → delete", async () => {
    const store = createFakeBlobStore(root);
    const key = makeKey("p1", "png");
    const { url } = await store.put(key, PNG.buffer as ArrayBuffer, "image/png");
    expect(url).toBe(`/api/files/${key}`);
    const got = await store.get(key);
    expect(got?.contentType).toBe("image/png");
    expect(got?.size).toBe(PNG.length);
    expect(new Uint8Array(await new Response(got!.stream).arrayBuffer())).toEqual(PNG);
    await store.delete(url);
    expect(await store.get(key)).toBeNull();
  });
  test("없는 파일과 잘못된 키는 null", async () => {
    const store = createFakeBlobStore(root);
    expect(await store.get(makeKey("p1", "png"))).toBeNull();
    expect(await store.get("../../etc/passwd")).toBeNull();
  });
});

describe("Vercel Blob 저장소", () => {
  test("비공개로 올리고 앱 URL을 돌려준다", async () => {
    const { createVercelBlobStore } = await import("@/lib/storage/vercel-blob");
    const store = createVercelBlobStore();
    const key = makeKey("p1", "webp");
    const { url } = await store.put(key, new Blob(["x"]), "image/webp");
    expect(url).toBe(`/api/files/${key}`);
    expect(putMock).toHaveBeenCalledWith(key, expect.anything(), expect.objectContaining({ access: "private", contentType: "image/webp" }));
  });
  test("비공개로 읽고, 삭제는 키로 한다", async () => {
    const { createVercelBlobStore } = await import("@/lib/storage/vercel-blob");
    const store = createVercelBlobStore();
    const key = makeKey("p1", "png");
    getMock.mockResolvedValueOnce({ statusCode: 200, stream: new Response("a").body, blob: { contentType: "image/png", size: 1 } });
    expect(await store.get(key)).toMatchObject({ contentType: "image/png", size: 1 });
    expect(getMock).toHaveBeenCalledWith(key, { access: "private" });
    getMock.mockResolvedValueOnce(null);
    expect(await store.get(key)).toBeNull();
    await store.delete(fileUrlForKey(key));
    expect(delMock).toHaveBeenCalledWith(key);
  });
});

describe("업로드 API", () => {
  test("로그인하지 않으면 401", async () => {
    expect((await upload(null, formWith("image/png", PNG))).status).toBe(401);
  });
  test("멤버는 이미지를 올리고 키 형식의 URL을 받는다", async () => {
    const res = await upload(member, formWith("image/png", PNG));
    expect(res.status).toBe(201);
    const { url } = (await res.json()) as { url: string };
    const key = keyFromUrl(url)!;
    expect(parseKey(key)?.projectId).toBe(projectId);
    expect(key).toMatch(new RegExp(`^projects/${projectId}/${new Date().getUTCFullYear()}/[0-9a-f-]{36}\\.png$`));
    expect(await createFakeBlobStore(root).get(key)).not.toBeNull();
  });
  test("비멤버 404, 없는 프로젝트 404", async () => {
    expect((await upload(outsider, formWith("image/png", PNG))).status).toBe(404);
    expect((await upload(member, formWith("image/png", PNG, "no-such-project"))).status).toBe(404);
  });
  test("비이미지 415", async () => {
    expect((await upload(member, formWith("text/html", new TextEncoder().encode("<b>")))).status).toBe(415);
    expect((await upload(member, formWith("image/svg+xml", new TextEncoder().encode("<svg/>")))).status).toBe(415);
  });
  test("10MB 초과 413", async () => {
    const big = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    expect((await upload(member, formWith("image/png", big))).status).toBe(413);
  });
  test("Content-Length가 한도를 크게 넘으면 본문을 읽지 않고 413", async () => {
    const form = formWith("image/png", PNG);
    const spy = vi.spyOn(Request.prototype, "formData");
    const res = await upload(member, form, { "content-length": String(MAX_UPLOAD_BYTES * 2) });
    expect(res.status).toBe(413);
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  test("정확히 10MB는 허용", async () => {
    const ok = new Uint8Array(MAX_UPLOAD_BYTES);
    expect((await upload(member, formWith("image/png", ok))).status).toBe(201);
  });
});
