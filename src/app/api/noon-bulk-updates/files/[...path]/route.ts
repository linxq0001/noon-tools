import { readFile } from "node:fs/promises";
import path from "node:path";
import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function GET(_: Request, { params }: { params: Promise<{ path: string[] }> }) {
  const parts = (await params).path || [];
  const filePath = safeBulkUpdateFilePath(parts);

  try {
    const file = await readFile(filePath);
    return new NextResponse(file, {
      headers: {
        "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "content-disposition": `attachment; filename="${path.basename(filePath)}"`,
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在，请先导出 Global 表。" }, { status: 404 });
  }
}

function safeBulkUpdateFilePath(parts: string[]) {
  const root = path.join(process.cwd(), "exports", "noon-bulk-updates", "global");
  const filePath = path.resolve(root, ...parts);

  if (!filePath.startsWith(`${path.resolve(root)}${path.sep}`)) {
    throw new Error("文件路径不合法。");
  }

  return filePath;
}
