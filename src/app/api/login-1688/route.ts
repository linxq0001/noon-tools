import { NextResponse } from "next/server";
import { startLogin1688Job } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    return NextResponse.json(startLogin1688Job(body), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录任务创建失败。" },
      { status: 400 },
    );
  }
}
