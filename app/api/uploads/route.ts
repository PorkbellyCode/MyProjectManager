import { connection } from "next/server";
import { db } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getBlobStore } from "@/lib/storage/blob-store";
import { handleUpload } from "@/lib/storage/upload";

export async function POST(request: Request): Promise<Response> {
  await connection();
  return handleUpload(request, { db, store: await getBlobStore(), getUser: getSessionUser });
}
