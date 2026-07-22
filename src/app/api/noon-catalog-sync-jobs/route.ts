import { NextResponse } from "next/server";
import { startNoonCatalogSyncJob } from "@/lib/jobs";
import { localAccessError } from "@/lib/local-access";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const accessError = localAccessError(request, { requireOrigin: true });
  if (accessError) return NextResponse.json({ error: accessError }, { status: 403 });
  try {
    const job = await startNoonCatalogSyncJob(await request.json());
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "同步 SKU 任务创建失败。" }, { status: 400 });
  }
}
