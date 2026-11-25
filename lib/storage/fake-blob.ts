import fs from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import { EXT_TO_TYPE, fileUrlForKey, keyFromUrl, parseKey, type BlobStore } from "./blob-store";

/** MPM_FAKE_BLOB=1 용 가짜 저장소. 파일을 로컬 디렉터리에 두고 같은 /api/files 라우트로 읽는다. */
export function createFakeBlobStore(root: string = path.resolve(process.cwd(), ".data/uploads-test")): BlobStore {
  const resolve = (key: string) => {
    if (!parseKey(key)) throw new Error(`잘못된 파일 키예요: ${key}`);
    return path.join(root, ...key.split("/"));
  };
  return {
    async put(key, data) {
      const file = resolve(key);
      await fs.mkdir(path.dirname(file), { recursive: true });
      const bytes = data instanceof Blob ? new Uint8Array(await data.arrayBuffer()) : new Uint8Array(data);
      await fs.writeFile(file, bytes);
      return { url: fileUrlForKey(key) };
    },
    async get(key) {
      let file: string;
      try {
        file = resolve(key);
      } catch {
        return null;
      }
      try {
        const stat = await fs.stat(file);
        const ext = key.slice(key.lastIndexOf(".") + 1);
        const { createReadStream } = await import("node:fs");
        const stream = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream<Uint8Array>;
        return { stream, contentType: EXT_TO_TYPE[ext] ?? "application/octet-stream", size: stat.size };
      } catch {
        return null;
      }
    },
    async delete(url) {
      const key = keyFromUrl(url);
      if (!key) return;
      await fs.rm(resolve(key), { force: true });
    },
  };
}
