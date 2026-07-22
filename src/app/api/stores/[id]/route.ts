import { NextResponse } from "next/server";
import { deleteStore, updateStore } from "@/lib/stores";

export const runtime = "nodejs";

export async function DELETE(_: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await deleteStore(decodeURIComponent(id)));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "删除店铺失败。" },
      { status: 400 },
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await context.params;
    return NextResponse.json(await updateStore(decodeURIComponent(id), await request.json()));
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "保存店铺失败。" },
      { status: 400 },
    );
  }
}
