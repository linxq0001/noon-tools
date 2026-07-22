import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import XLSX from "xlsx";
import {
  bulkUpdateFileNames,
  exportNoonBulkUpdates,
  verifyBulkUpdatePartnerSkus,
} from "../scripts/lib/noon-bulk-update-exporter.js";

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
    ["G-1001-1001-GOLD", "420222", 0.255, 0.6, 6, 15, "CN"],
    ["G-1001-1001-SILVER", "420222", 0.336, 0.7, 7, 16, "CN"],
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)), [
    ["partner_sku", "country_code", "price_usd", "is_active"],
    ["G-1001-1001-GOLD", "sa", 12.5, "TRUE"],
    ["G-1001-1001-SILVER", "sa", 13, "TRUE"],
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
    ["sa", "517205", "G-1001-1001-GOLD", "W00183886CN", 8, "2_days", 8, "2_days"],
    ["sa", "517205", "G-1001-1001-SILVER", "W00183886CN", 5, "2_days", 5, "2_days"],
  ]);
});

test("exportNoonBulkUpdates can limit output to selected product dirs", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-selected-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001");
  const secondProductDir = path.join(productsDir, "1688", "default", "1002");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "G-1001-1002-SILVER", barcode: "10010002", title: "Silver Bag" });

  const result = await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    productDirs: ["1688/default/1001"],
  });

  assert.equal(result.skuCount, 1);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates reads products from a platform repository", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-platform-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688", repository: "default" });

  assert.equal(result.productCount, 1);
  assert.equal(result.skuCount, 1);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1), [
    ["sa", "517205", "G-1001-1001-GOLD", "W00183886CN", 3, "2_days", 3, "2_days"],
  ]);
});

test("exportNoonBulkUpdates can write the uploaded store partner sku", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-uploaded-sku-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    partnerSkuByProductDir: {
      "default/1001": "G-1001-1001-GOLD-UAE01",
    },
  });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD-UAE01", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates writes only the uploaded sku when upload status scopes a product", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-uploaded-only-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.variants.push({ ...product.variants[0], partner_sku: "G-1001-1001-SILVER", barcode: "10010002" });
  await writeFile(filePath, JSON.stringify(product), "utf8");

  await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    partnerSkuByProductDir: {
      "default/1001": "G-1001-1001-GOLD-UAE01",
    },
  });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.product)).slice(1).map((row) => row[0]), [
    "G-1001-1001-GOLD-UAE01",
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1).map((row) => row[0]), [
    "G-1001-1001-GOLD-UAE01",
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1).map((row) => row[2]), [
    "G-1001-1001-GOLD-UAE01",
  ]);
});

test("exportNoonBulkUpdates writes multiple uploaded skus for one product", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-uploaded-many-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.variants.push({ ...product.variants[0], partner_sku: "G-1001-1001-SILVER", barcode: "10010002" });
  product.variants.push({ ...product.variants[0], partner_sku: "G-1001-1001-BLUE", barcode: "10010003" });
  await writeFile(filePath, JSON.stringify(product), "utf8");

  await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    partnerSkuByProductDir: {
      "default/1001": ["G-1001-1001-GOLD-UAE01", "G-1001-1001-SILVER-UAE01"],
    },
  });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1).map((row) => row[0]), [
    "G-1001-1001-GOLD-UAE01",
    "G-1001-1001-SILVER-UAE01",
  ]);
});

test("exportNoonBulkUpdates can scope output to selected uploaded products", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-selected-products-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001");
  const secondProductDir = path.join(productsDir, "1688", "default", "2002");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "G-1001-2002-SILVER", barcode: "20020001", title: "Silver Bag" });

  const result = await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    productDirs: ["1688/default/1001"],
    partnerSkuByProductDir: {
      "1688/default/1001": "G-1001-1001-GOLD-UAE01",
    },
  });

  assert.equal(result.productCount, 1);
  assert.equal(result.skuCount, 1);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [
    ["G-1001-1001-GOLD-UAE01", "sa", 10, "TRUE"],
  ]);
});

test("exportNoonBulkUpdates appends generated rows to existing workbooks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-append-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001");
  const secondProductDir = path.join(productsDir, "1688", "default", "2002");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "G-1001-2002-SILVER", barcode: "20020001", title: "Silver Bag" });

  await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    productDirs: ["default/1001"],
    partnerSkuByProductDir: {
      "default/1001": "G-1001-1001-GOLD-UAE01",
    },
  });
  await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: "default",
    productDirs: ["default/2002"],
    partnerSkuByProductDir: {
      "default/2002": "G-1001-2002-SILVER-UAE01",
    },
    append: true,
  });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1).map((row) => row[0]), [
    "G-1001-1001-GOLD-UAE01",
    "G-1001-2002-SILVER-UAE01",
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1).map((row) => row[2]), [
    "G-1001-1001-GOLD-UAE01",
    "G-1001-2002-SILVER-UAE01",
  ]);
});

test("verifyBulkUpdatePartnerSkus checks all three generated workbooks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-verify-sku-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688", repository: "default" });

  assert.deepEqual(verifyBulkUpdatePartnerSkus(result.files, ["G-1001-1001-GOLD"]), {
    ok: true,
    expectedSkus: ["G-1001-1001-GOLD"],
    missing: [],
  });
  assert.deepEqual(verifyBulkUpdatePartnerSkus(result.files, ["G-1001-1001-MISSING"]), {
    ok: false,
    expectedSkus: ["G-1001-1001-MISSING"],
    missing: [
      { file: "product", partnerSku: "G-1001-1001-MISSING" },
      { file: "price", partnerSku: "G-1001-1001-MISSING" },
      { file: "stock", partnerSku: "G-1001-1001-MISSING" },
    ],
  });
});

test("exportNoonBulkUpdates rewrites source platform names to internal platform ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-platform-id-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688", repository: "default" });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates keeps existing internal platform ids", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-internal-platform-id-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "G-1001-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688", repository: "default" });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates uses selected catalog prefixes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-catalog-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const noonOutputDir = path.join(tempDir, "exports-noon");
  const supermallOutputDir = path.join(tempDir, "exports-supermall");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  await exportNoonBulkUpdates({ productsDir, outputDir: noonOutputDir, platform: "1688", repository: "default", catalogType: "noon" });
  await exportNoonBulkUpdates({
    productsDir,
    outputDir: supermallOutputDir,
    platform: "1688",
    repository: "default",
    catalogType: "supermall",
  });

  assert.deepEqual(readRows(path.join(noonOutputDir, bulkUpdateFileNames.price)).slice(1), [["N-1001-1001-GOLD", "sa", 10, "TRUE"]]);
  assert.deepEqual(readRows(path.join(supermallOutputDir, bulkUpdateFileNames.price)).slice(1), [["S-1001-1001-GOLD", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates deduplicates product directories with the same product ID", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-product-dedupe-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001-clutch");
  const secondProductDir = path.join(productsDir, "1688", "evening-bags", "1001-evening-bag");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "1688-1001-DUPE", barcode: "10019999", title: "Duplicate Bag" });

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.equal(result.productCount, 1);
  assert.equal(result.skuCount, 1);
  assert.deepEqual(result.duplicateProducts, [
    {
      productKey: "1001",
      sources: ["default/1001-clutch", "evening-bags/1001-evening-bag"],
    },
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.product)).slice(1), [
    ["G-1001-1001-GOLD", "420222", 0.255, 0.5, 6, 15, "CN"],
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "TRUE"]]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1), [
    ["sa", "517205", "G-1001-1001-GOLD", "W00183886CN", 3, "2_days", 3, "2_days"],
  ]);
});

test("exportNoonBulkUpdates deduplicates repeated SKU rows inside one product", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-variant-dedupe-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-RED", barcode: "10010001", title: "Red Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.variants.push({ ...product.variants[0], barcode: "10019999" });
  await writeFile(filePath, JSON.stringify(product), "utf8");

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.equal(result.skuCount, 1);
  assert.deepEqual(result.duplicateSkus, [
    {
      partnerSku: "G-1001-1001-RED",
      sources: ["default/1001"],
    },
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-RED", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates deduplicates matching SKU rows across platform repositories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-dedupe-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001");
  const secondProductDir = path.join(productsDir, "1688", "evening-bags", "1002");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.equal(result.skuCount, 1);
  assert.deepEqual(result.duplicateSkus, [
    {
      partnerSku: "G-1001-1001-GOLD",
      sources: ["default/1001", "evening-bags/1002"],
    },
  ]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "TRUE"]]);
});

test("exportNoonBulkUpdates rejects conflicting duplicate SKU rows across platform repositories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-conflict-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1688", "default", "1001");
  const secondProductDir = path.join(productsDir, "1688", "evening-bags", "1002");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });
  await writeNoonProduct(firstProductDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  await writeNoonProduct(secondProductDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Edited Gold Bag" });

  await assert.rejects(
    () => exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" }),
    /Conflicting duplicate SKU G-1001-1001-GOLD: default\/1001, evening-bags\/1002/,
  );
});

test("exportNoonBulkUpdates skips products with blocking operation checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-blocking-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.operation_check = { status: "blocked", blockingIssues: [{ code: "missing_barcode", message: "variant 1 缺少 barcode。" }] };
  await writeFile(filePath, JSON.stringify(product), "utf8");

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.equal(result.skuCount, 0);
  assert.deepEqual(result.skippedProducts, [{ source: "default/1001", reason: "blocking_operation_check" }]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)), [["partner_sku", "country_code", "price_usd", "is_active"]]);
});

test("exportNoonBulkUpdates emits inactive price and zero stock rows", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-inactive-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.operation_status = "inactive";
  await writeFile(filePath, JSON.stringify(product), "utf8");

  await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "FALSE"]]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1), [
    ["sa", "517205", "G-1001-1001-GOLD", "W00183886CN", 0, "2_days", 0, "2_days"],
  ]);
});

function readRows(filePath) {
  const workbook = XLSX.readFile(filePath);
  return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
}

async function writeNoonProduct(productDir, { sku, barcode, title }) {
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
          partner_sku: sku,
          barcode,
          colour: "Gold",
          title_en: title,
          title_ar: "حقيبة ذهبية",
          actual_weight_kg: 0.5,
          length_cm: 17,
          width_cm: 6,
          height_cm: 15,
          price_usd: 10,
          stock: 3,
          processing_time: "2_days",
          warehouse_code: "W00183886CN",
          images: [{ path: "images/001.jpg" }],
        },
      ],
    }),
    "utf8",
  );
}
