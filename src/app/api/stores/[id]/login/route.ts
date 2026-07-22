import { NextResponse } from "next/server";
import { startNoonStoreLoginJob } from "@/lib/jobs";

export const runtime = "nodejs";

export async function POST(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await startNoonStoreLoginJob(decodeURIComponent(id)), { status: 201 });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "登录任务创建失败。" },
      { status: 400 },
    );
  }
}
