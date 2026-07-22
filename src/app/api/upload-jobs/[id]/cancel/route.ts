import { NextResponse } from "next/server";
import { cancelUploadJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const job = cancelUploadJob(id);
  if (!job) return NextResponse.json({ error: "找不到任务。" }, { status: 404 });
  return NextResponse.json(job);
}
