// 서버와 편집기가 함께 쓰는 값(의존성 없음).
// 4MB: Vercel 함수 요청 본문 한도가 4.5MB라서 그보다 작게 잡는다.
export const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;
export const TOO_LARGE_MESSAGE = "이미지는 4MB 이하만 올릴 수 있어요.";
