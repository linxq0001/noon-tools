import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { checkNoonProduct, checkNoonProducts } from "../scripts/lib/noon-operation-checks.js";

test("checkNoonProduct passes a complete product", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [],
    profitConfig: { costCny: 38, shippingCny: 12, exchangeRate: 1.96, platformFeeRate: 0.12, targetMargin: 0.28 },
    imageExists: () => true,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.warnings, []);
  assert.equal(result.variantCount, 1);
  assert.equal(result.skuCount, 1);
  assert.equal(result.profit.suggestedPriceAed, 42.52);
});

test("checkNoonProduct reports missing required variant fields", () => {
  const noon = completeNoon();
  delete noon.variants[0].barcode;
  delete noon.variants[0].actual_weight_kg;

  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon,
    allProducts: [],
    profitConfig: {},
    imageExists: () => true,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["missing_barcode", "missing_actual_weight_kg"]);
});

test("checkNoonProduct reports missing local images", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [],
    profitConfig: {},
    imageExists: () => false,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["missing_image_file"]);
});

test("checkNoonProduct reports duplicate SKU and barcode from allProducts", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [
      {
        productDir: "1688/default/1002",
        noon: {
          variants: [{ partner_sku: "1688-1001-GOLD", barcode: "10010001" }],
        },
      },
    ],
    profitConfig: {},
    imageExists: () => true,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["duplicate_partner_sku", "duplicate_barcode"]);
});

test("checkNoonProduct marks low margin as warning", () => {
  const noon = completeNoon();
  noon.variants[0].price_usd = 18;

  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon,
    allProducts: [],
    profitConfig: { costCny: 38, shippingCny: 12, exchangeRate: 1.96, platformFeeRate: 0.12, targetMargin: 0.28 },
    imageExists: () => true,
  });

  assert.equal(result.status, "warning");
  assert.deepEqual(result.blockingIssues, []);
  assert.deepEqual(result.warnings.map((issue) => issue.code), ["low_margin"]);
});

test("checkNoonProducts reads product directories and summarizes failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operation-checks-"));
  const productDir = path.join(root, "1688", "default", "1001");
  const imagesDir = path.join(productDir, "images");
  await mkdir(imagesDir, { recursive: true });
  await writeFile(path.join(productDir, "meta.json"), JSON.stringify(completeMeta()), "utf8");
  await writeFile(path.join(productDir, "noon-product-attributes.json"), JSON.stringify(completeNoon()), "utf8");
  await writeFile(path.join(imagesDir, "001.jpg"), "", "utf8");
  await writeFile(path.join(imagesDir, "002.jpg"), "", "utf8");
  await writeFile(path.join(imagesDir, "003.jpg"), "", "utf8");

  const result = await checkNoonProducts({
    productsDir: root,
    productDirs: ["1688/default/1001", "1688/default/missing"],
    profitConfig: { shippingCny: 12, exchangeRate: 1.96, platformFeeRate: 0.12, targetMargin: 0.28 },
  });

  assert.equal(result.summary.checkedCount, 2);
  assert.equal(result.summary.readyCount, 1);
  assert.equal(result.summary.blockedCount, 1);
  assert.equal(result.summary.warningCount, 0);
  assert.deepEqual(result.checked.map((item) => item.productDir), ["1688/default/1001", "1688/default/missing"]);
});

function completeMeta() {
  return {
    productId: "1001",
    sourceUrl: "https://detail.1688.com/offer/1001.html",
    title: "Gold evening bag",
    price: "38",
    collectedAt: "2026-06-18T00:00:00.000Z",
    images: [{ path: "images/001.jpg" }, { path: "images/002.jpg" }, { path: "images/003.jpg" }],
  };
}

function completeNoon() {
  return {
    product_group: {
      product_group_name_en: "Gold Evening Bag",
      product_group_name_ar: "حقيبة ذهبية",
      category: "Bags",
    },
    variants: [
      {
        partner_sku: "1688-1001-GOLD",
        barcode: "10010001",
        colour: "Gold",
        title_en: "Gold Evening Bag",
        title_ar: "حقيبة ذهبية",
        price_usd: 50,
        stock: 5,
        actual_weight_kg: 0.5,
        length_cm: 17,
        width_cm: 6,
        height_cm: 15,
        images: [{ path: "images/001.jpg" }, { path: "images/002.jpg" }, { path: "images/003.jpg" }],
      },
    ],
  };
}
