import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { deriveStorePartnerSku } from "../scripts/lib/noon-product-identity.js";
import { writeStoreNoonUploadStatus } from "../scripts/lib/noon-upload-status.js";
import {
  acquireStoreUploadLock,
  assertStoreUploadAllowed,
  scopeProductToStore,
} from "../scripts/lib/noon-upload-preflight.js";

function sampleNormalizedProduct() {
  const baseSku = "G-1001-123-V01-BLACK";
  return {
    productIdentity: {
      englishTitle: "Black Bag",
      partnerSku: baseSku,
      productImages: ["001.jpg"],
    },
    detailedContent: {
      modelNumber: baseSku,
      colour: "Black",
    },
    offerDetails: {
      offers: [
        {
          partnerSku: baseSku,
          barcode: "123456789012",
          currency: "SAR",
          stock: 7,
        },
      ],
    },
  };
}

async function makeUploadFixture() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-upload-preflight-"));
  const productsDir = path.join(rootDir, "products");
  const relativeDir = "1688/default/1001";
  const productDir = path.join(productsDir, relativeDir);
  const product = sampleNormalizedProduct();

  await mkdir(productDir, { recursive: true });
  await writeJson(path.join(productDir, "meta.json"), {
    source: "1688",
    productId: "1001",
    title: "Black Bag",
  });
  await writeJson(path.join(productDir, "noon-product-attributes.json"), {
    product_group: {
      product_group_name_en: "Black Bag",
    },
    variants: [
      {
        partner_sku: product.productIdentity.partnerSku,
        model_number: product.detailedContent.modelNumber,
        barcode: product.offerDetails.offers[0].barcode,
        colour: "Black",
      },
    ],
  });

  return {
    rootDir,
    productsDir,
    productDir,
    relativeDir,
    product,
    partnerSku: product.productIdentity.partnerSku,
    barcode: product.offerDetails.offers[0].barcode,
  };
}

async function addProduct(productsDir, relativeDir, options = {}) {
  const productDir = path.join(productsDir, relativeDir);
  await mkdir(productDir, { recursive: true });
  await writeJson(path.join(productDir, "meta.json"), {
    source: "1688",
    productId: path.basename(relativeDir),
    title: path.basename(relativeDir),
  });

  if (options.noonAttributes === "invalid") {
    await writeFile(path.join(productDir, "noon-product-attributes.json"), "{", "utf8");
  } else if (options.noonAttributes !== false) {
    await writeJson(path.join(productDir, "noon-product-attributes.json"), {
      product_group: {
        product_group_name_en: path.basename(relativeDir),
      },
      variants: [
        {
          partner_sku: options.partnerSku || `SKU-${path.basename(relativeDir)}`,
          model_number: options.partnerSku || `SKU-${path.basename(relativeDir)}`,
          barcode: options.barcode || `BAR-${path.basename(relativeDir)}`,
          colour: "Black",
        },
      ],
    });
  }

  return productDir;
}

async function writeJson(filePath, value) {
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

test("scopes first-variant upload identity without changing barcode", () => {
  const product = sampleNormalizedProduct();
  const scoped = scopeProductToStore(product, "UAE01");

  assert.equal(scoped.productIdentity.partnerSku, "G-1001-123-V01-BLACK-UAE01");
  assert.equal(scoped.detailedContent.modelNumber, "G-1001-123-V01-BLACK-UAE01");
  assert.equal(scoped.offerDetails.offers[0].partnerSku, "G-1001-123-V01-BLACK-UAE01");
  assert.equal(scoped.offerDetails.offers[0].barcode, product.offerDetails.offers[0].barcode);
  assert.equal(product.productIdentity.partnerSku, "G-1001-123-V01-BLACK");
});

test("blocks uploaded and concurrent store uploads", async () => {
  const fixture = await makeUploadFixture();
  await writeStoreNoonUploadStatus(
    fixture.productDir,
    { status: "uploaded", partnerSku: deriveStorePartnerSku(fixture.partnerSku, "UAE01") },
    "UAE01",
  );

  await assert.rejects(() => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }), /已经上传/);
  await assert.doesNotReject(() => assertStoreUploadAllowed({ ...fixture, storeId: "SA01" }));

  const storePartnerSku = deriveStorePartnerSku(fixture.partnerSku, "SA01");
  const lock = await acquireStoreUploadLock(fixture.productDir, "SA01", storePartnerSku);
  await assert.rejects(() => acquireStoreUploadLock(fixture.productDir, "SA01", storePartnerSku), /正在上传/);
  await lock.release();
});

test("reports duplicate base sku from local noon attributes", async () => {
  const fixture = await makeUploadFixture();
  await addProduct(fixture.productsDir, "1688/default/2002", {
    partnerSku: fixture.partnerSku,
    barcode: "987654321098",
  });

  await assert.rejects(
    () => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }),
    /重复基础 SKU[\s\S]*1688\/default\/1001[\s\S]*1688\/default\/2002/,
  );
});

test("reports duplicate store sku from store upload status files", async () => {
  const fixture = await makeUploadFixture();
  const otherProductDir = await addProduct(fixture.productsDir, "1688/default/2003", {
    partnerSku: "G-1001-2003-V01-BLUE",
    barcode: "987654321099",
  });
  const storePartnerSku = deriveStorePartnerSku(fixture.partnerSku, "UAE01");

  await writeStoreNoonUploadStatus(
    otherProductDir,
    {
      productDir: "1688/default/2003",
      status: "uploaded",
      partnerSku: storePartnerSku,
      message: "done",
    },
    "UAE01",
  );

  await assert.rejects(
    () => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }),
    /重复店铺 SKU[\s\S]*1688\/default\/1001[\s\S]*1688\/default\/2003/,
  );
});

test("reports duplicate barcodes with both product paths", async () => {
  const fixture = await makeUploadFixture();
  await addProduct(fixture.productsDir, "1688/default/2004", {
    partnerSku: "G-1001-2004-V01-GREEN",
    barcode: fixture.barcode,
  });

  await assert.rejects(
    () => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }),
    /重复条码[\s\S]*123456789012[\s\S]*1688\/default\/1001[\s\S]*1688\/default\/2004/,
  );
});

test("skips unrelated products missing noon attributes but rejects unreadable noon attributes", async () => {
  const fixture = await makeUploadFixture();
  await addProduct(fixture.productsDir, "1688/default/2005", { noonAttributes: false });
  await assert.doesNotReject(() => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }));

  await addProduct(fixture.productsDir, "1688/default/2006", { noonAttributes: "invalid" });
  await assert.rejects(
    () => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }),
    /noon-product-attributes\.json[\s\S]*1688\/default\/2006/,
  );
});

test("lock release is idempotent and removes the lock file", async () => {
  const fixture = await makeUploadFixture();
  const lock = await acquireStoreUploadLock(fixture.productDir, "UAE01", deriveStorePartnerSku(fixture.partnerSku, "UAE01"));
  const lockPath = path.join(fixture.productDir, ".noon-upload-lock-UAE01.json");

  await access(lockPath);
  await lock.release();
  await lock.release();

  await assert.rejects(() => access(lockPath));
});
