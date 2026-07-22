import { NextResponse } from "next/server";
import { listJobs, startCollectJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(listJobs());
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    return NextResponse.json(startCollectJob(body), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "任务创建失败。" },
      { status: 400 },
    );
  }
}
