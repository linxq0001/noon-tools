import { NextResponse } from "next/server";
import { readLatestNoonCatalogSync } from "@/lib/noon-catalog-sync";
import { localAccessError } from "@/lib/local-access";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const accessError = localAccessError(request);
  if (accessError) return NextResponse.json({ error: accessError }, { status: 403 });
  const url = new URL(request.url);
  const sync = await readLatestNoonCatalogSync({
    storeId: url.searchParams.get("storeId") || "",
    mode: url.searchParams.get("mode") || "global",
    page: Number(url.searchParams.get("page") || 1),
    pageSize: Number(url.searchParams.get("pageSize") || 50),
  });
  return NextResponse.json(sync);
}
