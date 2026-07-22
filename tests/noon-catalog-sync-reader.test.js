import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLatestNoonCatalogSync } from "../src/lib/noon-catalog-sync.ts";

test("reads latest synced Noon catalog rows for store and mode", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-sync-"));
  const syncDir = path.join(rootDir, "exports", "noon-catalog-sync");
  await mkdir(syncDir, { recursive: true });
  await writeFile(path.join(syncDir, "2026-07-07T00-00-00-000Z-PRJ550984-global.json"), JSON.stringify({
    storeId: "PRJ550984",
    mode: "global",
    catalogUrl: "https://example.test/catalog",
    title: "Catalog",
    headers: ["Product", "Price", "Inventory", "Performance", "Issues"],
    rows: [
      { cells: ["Product PSKU: P-1 SKU: S-1", " 12.00 Manual", "FBN 1 FBP 2", "Views - Units Sold - Sales (GMV) -", "View Issues"], imageUrl: "https://noon-catalog.noon.partners/_next/image/?url=https%3A%2F%2Fimg.test%2F1.jpg&w=64&q=75" },
    ],
    totalPages: 1,
  }));

  const result = await readLatestNoonCatalogSync({ rootDir, storeId: "PRJ550984", mode: "global" });

  assert.equal(result.synced, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].sku, "S-1");
  assert.equal(result.rows[0].psku, "P-1");
  assert.equal(result.rows[0].imageUrl, "https://img.test/1.jpg");
  assert.equal(result.rows[0].price, "12.00 Manual");
  assert.equal(result.rows[0].inventory, "FBN 1 FBP 2");
});

test("paginates Noon catalog rows before returning them to the browser", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-sync-page-"));
  const syncDir = path.join(rootDir, "exports", "noon-catalog-sync");
  await mkdir(syncDir, { recursive: true });
  await writeFile(path.join(syncDir, "2026-07-22T00-00-00-000Z-PRJ517205-global.json"), JSON.stringify({
    storeId: "PRJ517205",
    mode: "global",
    headers: ["Product", "Price", "Inventory", "Performance", "Issues"],
    rows: Array.from({ length: 125 }, (_, index) => ({
      cells: [`Product ${index + 1} PSKU: P-${index + 1} SKU: S-${index + 1}`, "1", "0", "", "live"],
      imageUrl: "",
    })),
  }));

  const result = await readLatestNoonCatalogSync({ rootDir, storeId: "PRJ517205", mode: "global", page: 2, pageSize: 50 });

  assert.equal(result.rows.length, 50);
  assert.equal(result.rows[0].sku, "S-51");
  assert.deepEqual(result.pagination, { page: 2, pageSize: 50, totalItems: 125, totalPages: 3 });
});

test("keeps the requested page size when no Noon catalog snapshot exists", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-sync-empty-page-"));

  const result = await readLatestNoonCatalogSync({ rootDir, storeId: "MISSING", mode: "global", page: 4, pageSize: 100 });

  assert.equal(result.synced, false);
  assert.deepEqual(result.pagination, { page: 1, pageSize: 100, totalItems: 0, totalPages: 1 });
});
