import { NextResponse } from "next/server";
import { createStore, listStores } from "@/lib/stores";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listStores());
}

export async function POST(request: Request) {
  try {
    const text = await request.text();
    const body = text ? JSON.parse(text) : {};
    return NextResponse.json(await createStore(body), { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "保存店铺失败。";
    return NextResponse.json(
      { error: message },
      { status: error instanceof Error && error.name === "StoreConflictError" ? 409 : 400 },
    );
  }
}
