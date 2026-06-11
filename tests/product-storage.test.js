import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  ensureRepository,
  productStoragePath,
  rebuildProductIndexes,
  readPlatformRepositories,
  resolveRepositoryId,
} from "../scripts/lib/product-storage.js";

test("productStoragePath stores single 1688 products in the default repository", () => {
  assert.equal(
    productStoragePath("/tmp/products", { platform: "1688", repository: "", productId: "958239268713" }),
    path.join("/tmp/products", "1688", "default", "958239268713"),
  );
});

test("resolveRepositoryId creates safe explicit repository ids", () => {
  assert.equal(resolveRepositoryId("晚宴包 第1批"), "晚宴包-第1批");
});

test("ensureRepository creates repository metadata for default and batch repositories", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "product-storage-"));
  const productsDir = path.join(tempDir, "products");

  await ensureRepository(productsDir, { platform: "1688", repository: "", name: "" });
  await ensureRepository(productsDir, { platform: "1688", repository: "evening-bags", name: "晚宴包" });

  assert.deepEqual(JSON.parse(await readFile(path.join(productsDir, "1688", "default", "repository.json"), "utf8")), {
    id: "default",
    name: "默认仓库",
    platform: "1688",
    kind: "default",
  });
  assert.deepEqual(JSON.parse(await readFile(path.join(productsDir, "1688", "evening-bags", "repository.json"), "utf8")), {
    id: "evening-bags",
    name: "晚宴包",
    platform: "1688",
    kind: "batch",
  });
});

test("readPlatformRepositories lists platform repositories with products and keeps legacy roots", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "product-storage-list-"));
  const productsDir = path.join(tempDir, "products");
  await mkdir(path.join(productsDir, "1688", "default", "1001"), { recursive: true });
  await mkdir(path.join(productsDir, "legacy-repo", "1002-title"), { recursive: true });
  await writeFile(path.join(productsDir, "1688", "default", "1001", "meta.json"), JSON.stringify({ productId: "1001" }), "utf8");
  await writeFile(path.join(productsDir, "legacy-repo", "1002-title", "meta.json"), JSON.stringify({ productId: "1002" }), "utf8");

  const repositories = await readPlatformRepositories(productsDir, "1688");

  assert.deepEqual(repositories.map((repository) => repository.id), ["default", "legacy-repo"]);
  assert.deepEqual(repositories[0].productDirs.map((product) => product.relativeDir), ["1688/default/1001"]);
  assert.deepEqual(repositories[1].productDirs.map((product) => product.relativeDir), ["legacy-repo/1002-title"]);
});

test("readPlatformRepositories merges legacy root products into the default repository", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "product-storage-legacy-default-"));
  const productsDir = path.join(tempDir, "products");
  await mkdir(path.join(productsDir, "1688", "default", "1001"), { recursive: true });
  await mkdir(path.join(productsDir, "1002-title"), { recursive: true });
  await writeFile(path.join(productsDir, "1688", "default", "1001", "meta.json"), JSON.stringify({ productId: "1001" }), "utf8");
  await writeFile(path.join(productsDir, "1002-title", "meta.json"), JSON.stringify({ productId: "1002" }), "utf8");

  const repositories = await readPlatformRepositories(productsDir, "1688");

  assert.deepEqual(repositories.map((repository) => repository.id), ["default"]);
  assert.deepEqual(repositories[0].productDirs.map((product) => product.relativeDir), ["1688/default/1001", "1002-title"]);
});

test("rebuildProductIndexes writes repository and platform index files", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "product-storage-index-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  await mkdir(productDir, { recursive: true });
  await writeFile(
    path.join(productDir, "meta.json"),
    JSON.stringify({ productId: "1001", title: "Gold Bag", status: "ready", collectedAt: "2026-06-09T00:00:00.000Z" }),
    "utf8",
  );
  await writeFile(
    path.join(productDir, "noon-product-attributes.json"),
    JSON.stringify({ variants: [{ partner_sku: "1688-1001-GOLD", images: [{ path: "images/001.jpg" }] }] }),
    "utf8",
  );

  await rebuildProductIndexes(productsDir, "1688");

  const repositoryIndex = JSON.parse(await readFile(path.join(productsDir, "1688", "default", "index.json"), "utf8"));
  const platformIndex = JSON.parse(await readFile(path.join(productsDir, "1688", "index.json"), "utf8"));
  assert.deepEqual(repositoryIndex.products, [
    {
      platform: "1688",
      repositoryId: "default",
      productId: "1001",
      title: "Gold Bag",
      status: "ready",
      variantCount: 1,
      imageCount: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
      relativeDir: "1688/default/1001",
    },
  ]);
  assert.deepEqual(platformIndex.repositories, [
    {
      id: "default",
      name: "默认仓库",
      productCount: 1,
      imageCount: 1,
      readyCount: 1,
      updatedAt: "2026-06-09T00:00:00.000Z",
    },
  ]);
});
