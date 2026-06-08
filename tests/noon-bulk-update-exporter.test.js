import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import { bulkUpdateFileNames, exportNoonBulkUpdates } from "../scripts/lib/noon-bulk-update-exporter.js";

test("exportNoonBulkUpdates writes product, price, and stock workbooks per SKU", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "repo-a", "1001-clutch");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeFile(
    path.join(productDir, "noon-product-attributes.json"),
    JSON.stringify({
      product_group: {
        hs_code: "420222",
        country_of_origin: "China",
      },
      upload_config: {
        country_code: "sa",
        id_partner: "517205",
      },
      variants: [
        {
          partner_sku: "1688-1001-GOLD",
          actual_weight_kg: 0.6,
          length_cm: 17,
          width_cm: 6,
          height_cm: 15,
          price_usd: 12.5,
          stock: 8,
          processing_time: "2_days",
          warehouse_code: "W00183886CN",
        },
        {
          partner_sku: "1688-1001-SILVER",
          actual_weight_kg: 0.7,
          length_cm: 18,
          width_cm: 7,
          height_cm: 16,
          price_usd: 13,
          stock: 5,
          processing_time: "2_days",
          warehouse_code: "W00183886CN",
        },
      ],
    }),
    "utf8",
  );

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, repository: "repo-a" });

  assert.equal(result.productCount, 1);
  assert.equal(result.skuCount, 2);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.product)), [
    [
      "partner_sku",
      "hs_code",
      "vm_weight_cm",
      "actual_weight_kg",
      "width_cm",
      "height_cm",
      "country_of_origin",
    ],
    ["1688-1001-GOLD", "420222", 0.255, 0.6, 6, 15, "CN"],
    ["1688-1001-SILVER", "420222", 0.336, 0.7, 7, 16, "CN"],
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)), [
    ["partner_sku", "country_code", "price_usd", "is_active"],
    ["1688-1001-GOLD", "sa", 12.5, "TRUE"],
    ["1688-1001-SILVER", "sa", 13, "TRUE"],
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)), [
    [
      "country_code",
      "id_partner",
      "partner_sku",
      "noon_warehouse_code",
      "current_stock_gross",
      "current_processing_time",
      "stock_gross",
      "processing_time",
    ],
    ["sa", "517205", "1688-1001-GOLD", "W00183886CN", 8, "2_days", 8, "2_days"],
    ["sa", "517205", "1688-1001-SILVER", "W00183886CN", 5, "2_days", 5, "2_days"],
  ]);
});

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
}
