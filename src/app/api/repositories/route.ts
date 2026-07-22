import { NextResponse } from "next/server";
import { listRepositorySummaries } from "@/lib/products";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await listRepositorySummaries());
}
