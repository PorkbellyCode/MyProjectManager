import { del, get, put } from "@vercel/blob";
import { fileUrlForKey, keyFromUrl, type BlobStore } from "./blob-store";

/**
 * Vercel Blob(비공개 저장소) 구현. 이 파일만 @vercel/blob을 import한다.
 * 인증은 SDK가 환경에서 고른다: Vercel에서는 VERCEL_OIDC_TOKEN + BLOB_STORE_ID(OIDC),
 * 로컬 등 그 밖에서는 BLOB_READ_WRITE_TOKEN. 키(pathname)로만 다루고 blob URL은 저장하지 않는다.
 */
export function createVercelBlobStore(): BlobStore {
  return {
    async put(key, data, contentType) {
      await put(key, data, {
        access: "private",
        contentType,
        addRandomSuffix: false,
        allowOverwrite: false,
      });
      return { url: fileUrlForKey(key) };
    },
    async get(key) {
      const result = await get(key, { access: "private" });
      if (!result || result.statusCode !== 200) return null;
      return { stream: result.stream, contentType: result.blob.contentType, size: result.blob.size };
    },
    async delete(url) {
      const key = keyFromUrl(url);
      if (!key) return;
      await del(key);
    },
  };
}
