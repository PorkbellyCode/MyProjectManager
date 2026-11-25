import type { Handler } from "./queue";
import type { JobKind } from "@/lib/db/schema";

// 작업 종류별 핸들러 레지스트리. 이후 Task에서 채운다.
export const handlers: Partial<Record<JobKind, Handler>> = {};
