import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyBulkOperation } from "../scripts/lib/noon-bulk-operations.js";

test("applyBulkOperation sets price on every variant", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_price", priceUsd: 18.5 },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 1);
  assert.equal(noon.variants[0].price_usd, 18.5);
  assert.equal(noon.operation_status, "active");
});

test("applyBulkOperation rejects malformed price strings", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_price", priceUsd: "18.5usd" },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.failed[0].productDir, productDir);
  assert.match(result.failed[0].error, /priceUsd/i);
  assert.equal(noon.variants[0].price_usd, 10);
  assert.equal(noon.operation_status, "active");
});

test("applyBulkOperation sets stock on every variant", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({ productsDir, productDirs: [productDir], operation: { type: "set_stock", stock: 9 } });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.variants[0].stock, 9);
});

test("applyBulkOperation rejects malformed stock strings", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_stock", stock: "9abc" },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 0);
  assert.equal(result.failedCount, 1);
  assert.equal(result.failed[0].productDir, productDir);
  assert.match(result.failed[0].error, /stock/i);
  assert.equal(noon.variants[0].stock, 3);
});

test("applyBulkOperation deactivates product and sets stock to zero", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({ productsDir, productDirs: [productDir], operation: { type: "deactivate" } });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.operation_status, "inactive");
  assert.equal(noon.variants[0].stock, 0);
});

test("applyBulkOperation stores processing time locally only", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_processing_time", processingTime: "5_days" },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.operation.processing_time, "5_days");
  assert.equal(noon.variants[0].processing_time, "2_days");
});

test("applyBulkOperation skips blocked products", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_price", priceUsd: 18.5 },
    operationCheckByProductDir: {
      [productDir]: {
        status: "blocked",
        blockingIssues: [{ code: "missing_barcode", message: "variant 1 缺少 barcode。" }],
      },
    },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(noon.variants[0].price_usd, 10);
});

async function createProduct() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bulk-operations-"));
  const productsDir = path.join(root, "products");
  const productDir = "1688/default/1001";
  const fullProductDir = path.join(productsDir, productDir);
  await mkdir(fullProductDir, { recursive: true });
  await writeFile(
    path.join(fullProductDir, "noon-product-attributes.json"),
    JSON.stringify({
      product_group: { product_group_name_en: "Gold Bag" },
      operation_status: "active",
      variants: [
        { partner_sku: "1688-1001-GOLD", barcode: "10010001", price_usd: 10, stock: 3, processing_time: "2_days" },
      ],
    }),
    "utf8",
  );
  return { productsDir, productDir };
}

async function readNoon(productsDir, productDir) {
  return JSON.parse(await readFile(path.join(productsDir, productDir, "noon-product-attributes.json"), "utf8"));
}
