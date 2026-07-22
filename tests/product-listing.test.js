import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  findRepositoryProductBySku,
  listRepositoryProducts,
  listRepositorySummaries,
  normalizeProductPageParams,
  productDirsForRepository,
} from "../scripts/lib/product-listing.js";

test("normalizeProductPageParams clamps invalid values", () => {
  assert.deepEqual(normalizeProductPageParams({ page: "0", pageSize: "500", status: "all", q: "  Bag  " }), {
    page: 1,
    pageSize: 100,
    status: "",
    q: "bag",
  });
  assert.deepEqual(normalizeProductPageParams({ page: "3", pageSize: "10", status: "uploaded", q: "" }), {
    page: 3,
    pageSize: 10,
    status: "uploaded",
    q: "",
  });
});

test("listRepositorySummaries returns summaries without product arrays", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag", imageCount: 2, generatedAt: "2026-07-01T00:00:00.000Z" },
    { repository: "default", productId: "1002", title: "Silver Bag", imageCount: 1, generatedAt: "2026-07-02T00:00:00.000Z" },
  ]);

  const summaries = await listRepositorySummaries({
    productsDir,
    storeId: "store-a",
    readProductSummary: fakeReadProductSummary(productsDir),
    buildRepositorySummary: fakeBuildRepositorySummary,
  });

  assert.equal(summaries.length, 1);
  assert.equal(summaries[0].id, "default");
  assert.equal(summaries[0].productCount, 2);
  assert.equal(summaries[0].imageCount, 3);
  assert.equal("products" in summaries[0], false);
});

test("listRepositoryProducts returns one repository page", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag", imageCount: 2 },
    { repository: "default", productId: "1002", title: "Silver Bag", imageCount: 1 },
    { repository: "default", productId: "1003", title: "Black Bag", imageCount: 1 },
  ]);

  const result = await listRepositoryProducts({
    productsDir,
    repositoryId: "default",
    page: 2,
    pageSize: 2,
    readProductSummary: fakeReadProductSummary(productsDir),
  });

  assert.equal(result.repository.id, "default");
  assert.deepEqual(result.products.map((product) => product.dirName), ["1688/default/1003"]);
  assert.deepEqual(result.pagination, {
    page: 2,
    pageSize: 2,
    totalItems: 3,
    totalPages: 2,
  });
});

test("listRepositoryProducts filters by search text and upload status", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag", uploaded: true },
    { repository: "default", productId: "1002", title: "Silver Bag", uploaded: false },
  ]);

  const result = await listRepositoryProducts({
    productsDir,
    repositoryId: "default",
    page: 1,
    pageSize: 20,
    status: "uploaded",
    q: "gold",
    readProductSummary: fakeReadProductSummary(productsDir),
  });

  assert.deepEqual(result.products.map((product) => product.title), ["Gold Bag"]);
  assert.equal(result.pagination.totalItems, 1);
});

test("listRepositoryProducts returns null for missing repositories", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag" },
  ]);

  const result = await listRepositoryProducts({
    productsDir,
    repositoryId: "missing",
    readProductSummary: fakeReadProductSummary(productsDir),
  });

  assert.equal(result, null);
});

test("productDirsForRepository expands a repository to every product dir", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag" },
    { repository: "default", productId: "1002", title: "Silver Bag" },
    { repository: "other", productId: "2001", title: "Blue Bag" },
  ]);

  assert.deepEqual(await productDirsForRepository({ productsDir, repositoryId: "default" }), [
    "1688/default/1001",
    "1688/default/1002",
  ]);
});

test("findRepositoryProductBySku resolves a local product on demand", async () => {
  const productsDir = await createProductsDir([
    { repository: "default", productId: "1001", title: "Gold Bag" },
    { repository: "default", productId: "1002", title: "Silver Bag" },
  ]);

  const result = await findRepositoryProductBySku({
    productsDir,
    partnerSku: "1688-1002",
    readProductSummary: fakeReadProductSummary(productsDir),
    readProductSkus: fakeReadProductSkus(productsDir),
  });

  assert.equal(result.title, "Silver Bag");
  assert.equal(result.dirName, "1688/default/1002");
});

test("server exposes repository summaries and paginated product routes", async () => {
  const serverSource = await readFile(new URL("../scripts/server.js", import.meta.url), "utf8");

  assert.match(serverSource, /from "\.\/lib\/product-listing\.js"/);
  assert.match(serverSource, /url\.pathname === "\/api\/repositories"/);
  assert.match(serverSource, /await listRepositorySummaries\(/);
  assert.match(serverSource, /await listRepositoryProducts\(/);
  assert.match(serverSource, /await findRepositoryProductBySku\(/);
  assert.match(serverSource, /normalizeProductPageParams/);
  assert.match(serverSource, /productDirsForRepository/);
});

async function createProductsDir(products) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "product-listing-"));
  const productsDir = path.join(tempDir, "products");

  for (const product of products) {
    const productDir = path.join(productsDir, "1688", product.repository, product.productId);
    await mkdir(productDir, { recursive: true });
    await writeFile(
      path.join(productDir, "meta.json"),
      JSON.stringify({
        productId: product.productId,
        title: product.title,
        generatedAt: product.generatedAt || "2026-07-01T00:00:00.000Z",
        downloadedCount: product.imageCount || 0,
        uploaded: Boolean(product.uploaded),
      }),
      "utf8",
    );
    await writeFile(
      path.join(productDir, "noon-product-attributes.json"),
      JSON.stringify({
        variants: [{ partner_sku: `1688-${product.productId}`, images: [] }],
      }),
      "utf8",
    );
  }

  return productsDir;
}

function fakeReadProductSummary(productsDir) {
  return async (relativeDir, repository) => {
    const meta = JSON.parse(await readFile(path.join(productsDir, relativeDir, "meta.json"), "utf8"));
    return {
      dirName: relativeDir,
      repository,
      title: meta.title,
      imageCount: meta.downloadedCount,
      generatedAt: meta.generatedAt,
      noonSummary: {
        title: meta.title,
        partnerSku: `1688-${meta.productId}`,
        imageCount: meta.downloadedCount,
      },
      noonUploadStatus: {
        uploaded: meta.uploaded,
      },
    };
  };
}

function fakeReadProductSkus(productsDir) {
  return async (relativeDir) => {
    const product = JSON.parse(await readFile(path.join(productsDir, relativeDir, "noon-product-attributes.json"), "utf8"));
    return (product.variants || []).map((variant) => variant.partner_sku);
  };
}

function fakeBuildRepositorySummary(id, name, products) {
  return {
    id,
    name,
    productCount: products.length,
    imageCount: products.reduce((sum, product) => sum + product.imageCount, 0),
    uploadableCount: products.filter((product) => product.noonSummary.imageCount > 0).length,
    blockedCount: 0,
    updatedAt: products[0]?.generatedAt || "",
    uploadStatus: {},
    globalBulkUpdate: {},
    products,
  };
}
