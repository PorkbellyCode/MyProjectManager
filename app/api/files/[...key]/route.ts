import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getMembership } from "@/lib/access";
import { getBlobStore, parseKey } from "@/lib/storage/blob-store";

const notFound = () => Response.json({ error: "not_found", message: "찾을 수 없어요." }, { status: 404 });

// 업로드 파일 읽기. 키의 프로젝트 멤버만 볼 수 있고, 아니면 404.
export async function GET(_request: Request, ctx: { params: Promise<{ key: string[] }> }): Promise<Response> {
  await connection();
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "unauthorized", message: "로그인이 필요해요." }, { status: 401 });

  const { key: segments } = await ctx.params;
  const key = segments.map(decodeURIComponent).join("/");
  const parsed = parseKey(key);
  if (!parsed) return notFound();
  if (!(await getMembership(db, parsed.projectId, user.id).catch(() => null))) return notFound();

  const file = await (await getBlobStore()).get(key);
  if (!file) return notFound();

  const headers: Record<string, string> = {
    "Content-Type": file.contentType,
    "Cache-Control": "private, max-age=3600",
    "X-Content-Type-Options": "nosniff",
    "Content-Disposition": "inline",
  };
  if (file.size != null) headers["Content-Length"] = String(file.size);
  return new Response(file.stream, { headers });
}
