import { NextResponse } from "next/server";
import { getUploadJob } from "@/lib/jobs";
import { localAccessError } from "@/lib/local-access";

export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const accessError = localAccessError(request);
  if (accessError) return NextResponse.json({ error: accessError }, { status: 403 });
  const { id } = await params;
  const job = getUploadJob(id);
  if (!job) return NextResponse.json({ error: "找不到任务。" }, { status: 404 });
  return NextResponse.json(job);
}
