import { NextResponse } from "next/server";
import { readUiSettings, saveUiSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readUiSettings());
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    return NextResponse.json(await saveUiSettings(body));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存设置失败。" },
      { status: 500 },
    );
  }
}
