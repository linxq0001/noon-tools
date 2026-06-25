import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { prepareNoonUploadProduct } from "../scripts/lib/noon-upload-product.js";

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
  assert.match(source, /prepareNoonUploadProduct\(rawProduct,\s*productDir,\s*storeId\)/);
  assert.match(source, /assertStoreUploadAllowed\(/);
  assert.match(source, /acquireStoreUploadLock\(/);
  assert.match(source, /status:\s*"uploading"/);
  assert.match(source, /status:\s*"failed"/);
  assert.doesNotMatch(source, /function normalizeProduct/);
  assert.doesNotMatch(source, /writeNoonUploadStatus/);
});
