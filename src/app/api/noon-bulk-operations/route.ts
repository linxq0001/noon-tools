import { NextResponse } from "next/server";
import { applyNoonWorkbenchBulkAction } from "@/lib/noon-workbench-bulk-actions";
import { findStoreSecret } from "@/lib/stores";

export const runtime = "nodejs";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const storeId = String(body.storeId || "").trim();
    const store = storeId ? await findStoreSecret(storeId) : null;
    const result = await applyNoonWorkbenchBulkAction({
      skus: Array.isArray(body.skus) ? body.skus : [],
      items: Array.isArray(body.items) ? body.items : [],
      operation: body.operation,
      apiOptions: store?.apiToken ? { token: store.apiToken } : undefined,
    });
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "批量操作失败。" }, { status: 400 });
  }
}
