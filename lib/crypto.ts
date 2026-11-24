import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { env } from "@/lib/env";

/**
 * AES-256-GCM. 저장 형식: `v1:<base64(iv[12] | tag[16] | ciphertext)>`.
 * APP_ENCRYPTION_KEY 형식: 32바이트를 base64로 인코딩한 문자열
 * (생성: `openssl rand -base64 32`). 접두의 `v1`은 키 버전이다.
 */
const VERSION = "v1";

export function parseKey(raw: string): Buffer {
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("APP_ENCRYPTION_KEY는 32바이트를 base64로 인코딩한 값이어야 해요 (openssl rand -base64 32).");
  }
  return key;
}

export function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", parseKey(env.APP_ENCRYPTION_KEY), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return `${VERSION}:${Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64")}`;
}

export function decrypt(enc: string): string {
  const idx = enc.indexOf(":");
  if (idx < 0 || enc.slice(0, idx) !== VERSION) {
    throw new Error("지원하지 않는 암호화 키 버전이에요.");
  }
  const raw = Buffer.from(enc.slice(idx + 1), "base64");
  const decipher = createDecipheriv("aes-256-gcm", parseKey(env.APP_ENCRYPTION_KEY), raw.subarray(0, 12));
  decipher.setAuthTag(raw.subarray(12, 28));
  return Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8");
}
