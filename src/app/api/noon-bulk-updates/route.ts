import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { NextResponse } from "next/server";
import { resolveProductDirsForSkus } from "@/lib/noon-workbench-bulk-actions";

const execFileAsync = promisify(execFile);

export const runtime = "nodejs";

const fileNames = {
  product: "global-product-update.xlsx",
  price: "global-price-update.xlsx",
  stock: "stock-import.xlsx",
};

export async function POST(request: Request) {
  const rootDir = process.cwd();
  const outputDir = path.join(rootDir, "exports", "noon-bulk-updates", "global", "all");

  try {
    const body = await request.json().catch(() => ({}));
    const selectedSkus = Array.isArray(body.skus) ? body.skus : [];
    const resolved = await resolveProductDirsForSkus({
      skus: selectedSkus,
    });
    if (selectedSkus.length && !resolved.productDirs.length) {
      return NextResponse.json({ error: "选中的 SKU 未匹配到本地商品，无法导出。", ...resolved }, { status: 400 });
    }
    const args = [
      "scripts/export-noon-bulk-updates.js",
      "products",
      outputDir,
      "--catalog-type",
      "global",
    ];
    if (resolved.productDirs.length) args.push("--product-dirs", resolved.productDirs.join(","));
    const { stdout } = await execFileAsync(process.execPath, args, { cwd: rootDir });

    return NextResponse.json({
      skuCount: parseSkuCount(stdout),
      ...resolved,
      files: {
        product: `/api/noon-bulk-updates/files/all/${fileNames.product}`,
        price: `/api/noon-bulk-updates/files/all/${fileNames.price}`,
        stock: `/api/noon-bulk-updates/files/all/${fileNames.stock}`,
      },
    });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "导出 Global 表失败。" }, { status: 500 });
  }
}

function parseSkuCount(output: string) {
  return Number(output.match(/Exported (\d+) SKU row/)?.[1] || 0);
}
