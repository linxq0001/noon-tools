import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareNoonUploadProduct, prepareNoonUploadProducts } from "../scripts/lib/noon-upload-product.js";

async function makeProductDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-product-"));
  const productDir = path.join(root, "products", "1688", "default", "1001");
  await mkdir(productDir, { recursive: true });
  await writeFile(path.join(productDir, "001.jpg"), "image", "utf8");
  await writeFile(path.join(productDir, "002.jpg"), "image", "utf8");
  return productDir;
}

function currentProduct() {
  return {
    product_group: {
      product_group_name_en: "Black Bag",
      product_group_name_ar: "حقيبة سوداء",
      brand: "Generic",
      category: "Bags > Women",
      gender: "Female",
      size: "One Size",
    },
    variants: [
      {
        title_en: "Black Bag Variant",
        partner_sku: "G-1001-1001-V01-BLACK",
        model_number: "G-1001-1001-V01-BLACK",
        barcode: "123456789012",
        colour: "Black",
        colour_name: "Black",
        images: [{ path: "002.jpg" }],
        price_sar_initial: 49,
        stock: 8,
      },
      {
        title_en: "Blue Bag Variant",
        partner_sku: "G-1001-1001-V02-BLUE",
        model_number: "G-1001-1001-V02-BLUE",
        barcode: "123456789029",
        colour: "Blue",
      },
    ],
  };
}

test("prepares only the first current variant with store-scoped sku and unchanged barcode", async () => {
  const productDir = await makeProductDir();
  const product = await prepareNoonUploadProduct(currentProduct(), productDir, "uae01");

  assert.equal(product.productIdentity.englishTitle, "Black Bag Variant");
  assert.equal(product.productIdentity.partnerSku, "G-1001-1001-V01-BLACK-UAE01");
  assert.deepEqual(product.productIdentity.productImages, ["002.jpg"]);
  assert.equal(product.detailedContent.modelNumber, "G-1001-1001-V01-BLACK-UAE01");
  assert.equal(product.offerDetails.offers.length, 1);
  assert.equal(product.offerDetails.offers[0].partnerSku, "G-1001-1001-V01-BLACK-UAE01");
  assert.equal(product.offerDetails.offers[0].barcode, "123456789012");
});

test("prepares one upload product per current variant", async () => {
  const productDir = await makeProductDir();
  const products = await prepareNoonUploadProducts(currentProduct(), productDir, "uae01");

  assert.equal(products.length, 2);
  assert.deepEqual(products.map((product) => product.productIdentity.partnerSku), [
    "G-1001-1001-V01-BLACK-UAE01",
    "G-1001-1001-V02-BLUE-UAE01",
  ]);
  assert.deepEqual(products.map((product) => product.productIdentity.englishTitle), ["Black Bag Variant", "Blue Bag Variant"]);
  assert.deepEqual(products.map((product) => product.offerDetails.offers[0].barcode), ["123456789012", "123456789029"]);
});

test("prepares upload product from group-level shared variant fields", async () => {
  const productDir = await makeProductDir();
  const rawProduct = currentProduct();
  rawProduct.product_group.description_en = "Shared English description.";
  rawProduct.product_group.description_ar = "وصف عربي مشترك.";
  rawProduct.product_group.feature_bullets_en = ["Shared bullet"];
  rawProduct.product_group.feature_bullets_ar = ["نقطة مشتركة"];
  rawProduct.product_group.length_cm = 18;
  rawProduct.product_group.width_cm = 5;
  rawProduct.product_group.height_cm = 11;
  rawProduct.product_group.actual_weight_kg = 2;
  rawProduct.product_group.price_sar_initial = 180;
  rawProduct.product_group.stock = 4;
  rawProduct.product_group.warehouse_code = "W00183886CN";
  rawProduct.product_group.images = ["001.jpg", "002.jpg"];
  delete rawProduct.variants[0].images;
  delete rawProduct.variants[0].price_sar_initial;
  delete rawProduct.variants[0].stock;

  const product = await prepareNoonUploadProduct(rawProduct, productDir, "uae01");

  assert.deepEqual(product.productIdentity.productImages, ["001.jpg", "002.jpg"]);
  assert.deepEqual(product.productContent.featureBullets, ["Shared bullet"]);
  assert.equal(product.productContent.longDescription, "Shared English description.");
  assert.equal(product.productContent.arabicLongDescription, "وصف عربي مشترك.");
  assert.equal(product.detailedContent.productLength, 18);
  assert.equal(product.detailedContent.productWidth, 5);
  assert.equal(product.detailedContent.productHeight, 11);
  assert.equal(product.detailedContent.productWeight, 2);
  assert.equal(product.offerDetails.offers[0].price, 180);
  assert.equal(product.offerDetails.offers[0].stock, 4);
  assert.equal(product.offerDetails.offers[0].warehouse, "W00183886CN");
});

test("rejects legacy normalized upload products", async () => {
  const productDir = await makeProductDir();

  await assert.rejects(
    () => prepareNoonUploadProduct({
      productIdentity: {
        englishTitle: "Old",
        partnerSku: "OLD-SKU",
        productImages: ["001.jpg"],
      },
    }, productDir, "UAE01"),
    /product_group.*variants/,
  );
});

test("upload-noon wires current identity, preflight, lock, and store status", async () => {
  const source = await readFile(new URL("../scripts/upload-noon.js", import.meta.url), "utf8");

  assert.match(source, /regenerateProductIdentities\(productsDir\)/);
  assert.match(source, /prepareNoonUploadProducts\(rawProduct,\s*productDir,\s*storeId\)/);
  assert.match(source, /assertStoreUploadAllowed\(/);
  assert.match(source, /acquireStoreUploadLock\(/);
  assert.match(source, /status:\s*"uploading"/);
  assert.match(source, /status:\s*"failed"/);
  assert.doesNotMatch(source, /function normalizeProduct/);
  assert.doesNotMatch(source, /writeNoonUploadStatus/);
});

test("offer details does not fill size with the generic text field helper", async () => {
  const source = await readFile(new URL("../scripts/upload-noon.js", import.meta.url), "utf8");

  assert.doesNotMatch(source, /fillOptionalField\(page,\s*"Size",\s*offer\.size\)/);
});

test("server verifies uploaded partner skus after writing global bulk update files", async () => {
  const source = await readFile(new URL("../scripts/server.js", import.meta.url), "utf8");

  assert.match(source, /verifyBulkUpdatePartnerSkus/);
  assert.match(source, /partnerSkuByProductDir/);
  assert.match(source, /uploadedPartnerSkusForJob/);
  assert.match(source, /append:\s*true/);
  assert.match(source, /SKU 校验通过/);
});
