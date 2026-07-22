import { NextResponse } from "next/server";
import { listUploadJobs, startUploadJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listUploadJobs());
}

export async function POST(request: Request) {
  try {
    const job = await startUploadJob(await request.json());
    return NextResponse.json(job, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "上传任务创建失败。" }, { status: 400 });
  }
}
