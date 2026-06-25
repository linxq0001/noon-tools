import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildBasePartnerSku,
  buildPartnerBarcode,
  deriveStorePartnerSku,
  regenerateProductIdentities,
  upcCheckDigit,
} from "../scripts/lib/noon-product-identity.js";

test("buildBasePartnerSku builds unique descriptive variant SKUs", () => {
  assert.equal(buildBasePartnerSku({ productId: "123", variantIndex: 0, colourCode: "Black" }), "G-1001-123-V01-BLACK");
  assert.equal(buildBasePartnerSku({ productId: "123", variantIndex: 1, colourCode: "Black" }), "G-1001-123-V02-BLACK");
  assert.equal(deriveStorePartnerSku("G-1001-123-V01-BLACK", "uae01"), "G-1001-123-V01-BLACK-UAE01");
});

test("buildPartnerBarcode generates stable 12 digit store-independent barcodes", () => {
  const first = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 0, occupied: new Set() });
  const repeated = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 0, occupied: new Set() });
  const sibling = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 1, occupied: new Set([first]) });

  assert.match(first, /^[0-9]{12}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, sibling);
  assert.equal(first.at(-1), upcCheckDigit(first.slice(0, 11)));
});

test("regenerateProductIdentities rewrites stored sku model number and barcode with current rules", async () => {
  const productsDir = await makeBarcodeProducts([
    {
      relativeDir: "1688/default/200",
      metaProductId: "200SRC",
      variants: [{ partner_sku: "OLD-200", model_number: "OLD-MODEL-200", barcode: "202604280001", colour_name: "Silver" }],
    },
    {
      relativeDir: "1688/default/100",
      metaProductId: "100SRC",
      variants: [{ partner_sku: "OLD-100", model_number: "OLD-MODEL-100", barcode: "888888888888", colour: "Black" }],
    },
  ]);

  const result = await regenerateProductIdentities(productsDir);
  const firstRun100 = await readVariant(productsDir, "1688/default/100", 0);
  const firstRun200 = await readVariant(productsDir, "1688/default/200", 0);
  const rerun = await regenerateProductIdentities(productsDir);

  assert.deepEqual(result.changedProducts, ["1688/default/100", "1688/default/200"]);
  assert.deepEqual(result.skippedProducts, []);
  assert.equal(firstRun100.partner_sku, "G-1001-100SRC-V01-BLACK");
  assert.equal(firstRun100.model_number, "G-1001-100SRC-V01-BLACK");
  assert.match(firstRun100.barcode, /^[0-9]{12}$/);
  assert.equal(firstRun200.partner_sku, "G-1001-200SRC-V01-SILVER");
  assert.equal(firstRun200.model_number, "G-1001-200SRC-V01-SILVER");
  assert.match(firstRun200.barcode, /^[0-9]{12}$/);
  assert.notEqual(firstRun100.barcode, "888888888888");
  assert.notEqual(firstRun200.barcode, "202604280001");
  assert.notEqual(firstRun100.barcode, firstRun200.barcode);
  assert.deepEqual(rerun.changedProducts, []);
  assert.deepEqual(rerun.skippedProducts, []);
  assert.deepEqual(await readVariant(productsDir, "1688/default/100", 0), firstRun100);
  assert.deepEqual(await readVariant(productsDir, "1688/default/200", 0), firstRun200);
});

test("regenerateProductIdentities uses variant order and directory fallback when meta source product id is missing", async () => {
  const productsDir = await makeBarcodeProducts([
    {
      relativeDir: "1688/default/200",
      omitMeta: true,
      variants: [
        { partner_sku: "OLD-A", model_number: "OLD-A", barcode: "202604280001", colour_name: "Blue" },
        { partner_sku: "OLD-B", model_number: "OLD-B", barcode: "999999999999", colour: "Red" },
      ],
    },
  ]);

  const result = await regenerateProductIdentities(productsDir);
  const barcodes = await readBarcodes(productsDir, "1688/default/200");
  const firstVariant = await readVariant(productsDir, "1688/default/200", 0);
  const secondVariant = await readVariant(productsDir, "1688/default/200", 1);
  const expectedFirst = buildPartnerBarcode({ platform: "1688", productId: "200", variantIndex: 0, occupied: new Set() });
  const expectedSecond = buildPartnerBarcode({ platform: "1688", productId: "200", variantIndex: 1, occupied: new Set([expectedFirst]) });

  assert.deepEqual(result.changedProducts, ["1688/default/200"]);
  assert.deepEqual(result.skippedProducts, []);
  assert.deepEqual(barcodes, [expectedFirst, expectedSecond]);
  assert.equal(firstVariant.partner_sku, "G-1001-200-V01-BLUE");
  assert.equal(firstVariant.model_number, "G-1001-200-V01-BLUE");
  assert.equal(secondVariant.partner_sku, "G-1001-200-V02-RED");
  assert.equal(secondVariant.model_number, "G-1001-200-V02-RED");
});

test("regenerateProductIdentities reports skipped products when noon attributes are missing", async () => {
  const productsDir = await makeBarcodeProducts([{ relativeDir: "1688/default/300", omitNoonProductAttributes: true }]);

  const result = await regenerateProductIdentities(productsDir);

  assert.deepEqual(result.changedProducts, []);
  assert.equal(result.skippedProducts.length, 1);
  assert.equal(result.skippedProducts[0].productDir, "1688/default/300");
  assert.match(result.skippedProducts[0].reason, /ENOENT|no such file/i);
});

async function makeBarcodeProducts(entries) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-product-identity-"));
  const productsDir = path.join(tempDir, "products");

  for (const entry of entries) {
    const productDir = path.join(productsDir, entry.relativeDir);
    const productId = path.basename(entry.relativeDir);
    const variants = Array.isArray(entry.variants)
      ? entry.variants
      : [
          {
            partner_sku: entry.partnerSku || "",
            model_number: entry.modelNumber || "",
            barcode: entry.barcode || "",
          },
        ];

    await mkdir(productDir, { recursive: true });
    if (!entry.omitMeta) {
      await writeFile(
        path.join(productDir, "meta.json"),
        `${JSON.stringify({ productId, source: entry.omitSourceProductId ? {} : { productId: entry.metaProductId || productId }, title: `Product ${productId}` }, null, 2)}\n`,
        "utf8",
      );
    }
    if (!entry.omitNoonProductAttributes) {
      await writeFile(
        path.join(productDir, "noon-product-attributes.json"),
        `${JSON.stringify(
          {
            product_group: {},
            variants: variants.map((variant, index) => ({
              partner_sku: variant.partner_sku || `G-1001-${productId}-V${String(index + 1).padStart(2, "0")}-COLOUR`,
              model_number: variant.model_number || variant.partner_sku || `G-1001-${productId}-V${String(index + 1).padStart(2, "0")}-COLOUR`,
              barcode: variant.barcode,
              colour_name: variant.colour_name || "",
              colour: variant.colour || "",
            })),
          },
          null,
          2,
        )}\n`,
        "utf8",
      );
    }
  }

  return productsDir;
}

async function readBarcode(productsDir, relativeDir) {
  return (await readBarcodes(productsDir, relativeDir))[0];
}

async function readBarcodes(productsDir, relativeDir) {
  const filePath = path.join(productsDir, relativeDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  return product.variants.map((variant) => variant.barcode);
}

async function readVariant(productsDir, relativeDir, index) {
  const filePath = path.join(productsDir, relativeDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  return product.variants[index];
}
