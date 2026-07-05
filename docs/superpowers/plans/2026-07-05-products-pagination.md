# Products Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split product repository loading so the UI loads repository summaries first and product rows by repository page instead of downloading every product at once.

**Architecture:** Move repository and paginated product listing into a small testable library, keep `scripts/server.js` as a thin HTTP router, then update `public/index.html` to request repository summaries and product pages separately. Preserve the existing file-based storage, upload status readers, Noon Catalog sync, and bulk export flows.

**Tech Stack:** Node.js ESM, `node:test`, local JSON files under `products/`, existing static `public/index.html`, existing local HTTP server in `scripts/server.js`.

## Global Constraints

- Do not introduce a database, cache service, or new dependency.
- Do not change the `products/` directory structure.
- Do not rewrite Noon Catalog sync or the operations workbench.
- Keep page size default at `20` and maximum at `100`.
- `GET /api/repositories` must not return repository `products` arrays.
- `GET /api/products` must require `repository` and return only the selected repository page.
- Repository upload must pass `repository` to the backend; the backend expands it to all product directories.
- Keep changes scoped to product listing and repository upload behavior.

---

## File Structure

- Create `scripts/lib/product-listing.js`
  - Owns repository summaries, paginated product listing, filtering, pagination normalization, and repository upload expansion.
  - Exports pure async helpers that accept injected filesystem paths and existing callback dependencies where useful.

- Create `tests/product-listing.test.js`
  - Tests repository summaries, product pagination, search, upload-status filtering, page size limits, missing repository behavior, and repository upload expansion.

- Modify `scripts/server.js`
  - Imports helpers from `scripts/lib/product-listing.js`.
  - Adds `GET /api/repositories`.
  - Changes `GET /api/products` to require `repository` and return paginated output.
  - Changes `POST /api/upload-jobs` to accept `repository` and expand it server-side.
  - Leaves existing `GET /api/noon-catalog-sync` and bulk operation routes unchanged.

- Modify `public/index.html`
  - Changes `refreshProducts()` to load `/api/repositories`.
  - Adds upload-page pagination state and `loadProductPage(...)`.
  - Changes repository selection, status filter, search, and pager interactions to fetch server pages.
  - Changes repository upload button to call `startUploadJob({ repository: repository.id })`.
  - Keeps operations workbench rendering from Noon Catalog sync data.

- Modify `tests/repository-dialog-ui.test.js`
  - Updates static assertions for the new endpoint names and repository upload payload.

---

### Task 1: Add Product Listing Library

**Files:**
- Create: `scripts/lib/product-listing.js`
- Test: `tests/product-listing.test.js`

**Interfaces:**
- Consumes:
  - `readPlatformRepositories(productsDir, "1688")` from `scripts/lib/product-storage.js`
  - `readProductSummary(relativeDir, repositoryId, storeId)` callback supplied by `scripts/server.js`
  - `buildRepositorySummary(repositoryId, repositoryName, products)` callback supplied by `scripts/server.js`
  - `productUploadStatus(product)` local helper in this new module
- Produces:
  - `normalizeProductPageParams(input: object): { page: number, pageSize: number, status: string, q: string }`
  - `listRepositorySummaries({ productsDir, storeId, readProductSummary, buildRepositorySummary }): Promise<Array<object>>`
  - `listRepositoryProducts({ productsDir, repositoryId, storeId, page, pageSize, status, q, readProductSummary }): Promise<{ repository: object, products: Array<object>, pagination: object }>`
  - `productDirsForRepository({ productsDir, repositoryId }): Promise<Array<string>>`

- [ ] **Step 1: Write failing tests for pagination params and repository summaries**

Add this to `tests/product-listing.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
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
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
node --test tests/product-listing.test.js
```

Expected: FAIL with `Cannot find module ... scripts/lib/product-listing.js`.

- [ ] **Step 3: Add the product listing module**

Create `scripts/lib/product-listing.js`:

```js
import { readPlatformRepositories } from "./product-storage.js";

export function normalizeProductPageParams(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page ?? "1", 10) || 1);
  const rawPageSize = Number.parseInt(input.pageSize ?? "20", 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));
  const status = String(input.status || "").trim() === "all" ? "" : String(input.status || "").trim();
  const q = String(input.q || "").trim().toLowerCase();
  return { page, pageSize, status, q };
}

export async function listRepositorySummaries({ productsDir, storeId = "", readProductSummary, buildRepositorySummary } = {}) {
  const repositories = await readPlatformRepositories(productsDir, "1688");
  const summaries = [];

  for (const repository of repositories) {
    const products = [];
    for (const productDir of repository.productDirs) {
      products.push(await readProductSummary(productDir.relativeDir, repository.id, storeId));
    }
    const summary = buildRepositorySummary(repository.id, repository.name, products);
    delete summary.products;
    summaries.push(summary);
  }

  return summaries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function listRepositoryProducts({
  productsDir,
  repositoryId,
  storeId = "",
  page = 1,
  pageSize = 20,
  status = "",
  q = "",
  readProductSummary,
} = {}) {
  const repository = await findRepository(productsDir, repositoryId);
  if (!repository) return null;

  const products = [];
  for (const productDir of repository.productDirs) {
    const product = await readProductSummary(productDir.relativeDir, repository.id, storeId);
    if (status && productUploadStatus(product) !== status) continue;
    if (q && !productMatchesQuery(product, q)) continue;
    products.push(product);
  }

  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    repository: {
      id: repository.id,
      name: repository.name,
      productCount: repository.productDirs.length,
    },
    products: products.slice(start, start + pageSize),
    pagination: {
      page: currentPage,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

export async function productDirsForRepository({ productsDir, repositoryId } = {}) {
  const repository = await findRepository(productsDir, repositoryId);
  return repository ? repository.productDirs.map((productDir) => productDir.relativeDir) : [];
}

async function findRepository(productsDir, repositoryId) {
  const normalizedId = String(repositoryId || "").trim();
  if (!normalizedId) return null;
  const repositories = await readPlatformRepositories(productsDir, "1688");
  return repositories.find((repository) => repository.id === normalizedId) || null;
}

function productMatchesQuery(product, q) {
  return [
    product.title,
    product.dirName,
    product.noonSummary?.title,
    product.noonSummary?.partnerSku,
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

function productUploadStatus(product) {
  const status = product.noonUploadStatus || {};
  if (status.uploaded) return "uploaded";
  if (status.status === "uploading") return "uploading";
  if (status.status === "failed" || status.error) return "failed";
  return "not_uploaded";
}
```

- [ ] **Step 4: Add remaining product listing tests**

Append this to `tests/product-listing.test.js`:

```js
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
    const meta = JSON.parse(await import("node:fs/promises").then(({ readFile }) => readFile(path.join(productsDir, relativeDir, "meta.json"), "utf8")));
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
        uploaded: meta.productId === "1001",
      },
    };
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
```

- [ ] **Step 5: Run product listing tests**

Run:

```bash
node --test tests/product-listing.test.js
```

Expected: PASS.

- [ ] **Step 6: Commit Task 1**

```bash
git add scripts/lib/product-listing.js tests/product-listing.test.js
git commit -m "Add product listing pagination helpers"
```

---

### Task 2: Wire Paginated APIs Into Server

**Files:**
- Modify: `scripts/server.js`
- Test: `tests/product-listing.test.js`

**Interfaces:**
- Consumes from Task 1:
  - `listRepositorySummaries(...)`
  - `listRepositoryProducts(...)`
  - `normalizeProductPageParams(...)`
  - `productDirsForRepository(...)`
- Produces:
  - `GET /api/repositories?storeId=...`
  - `GET /api/products?repository=...&page=...&pageSize=...&status=...&q=...&storeId=...`
  - `POST /api/upload-jobs` accepts `repository` and expands it to `productDirs`

- [ ] **Step 1: Add a static server wiring test**

Append this to `tests/product-listing.test.js`:

```js
test("server exposes repository summaries and paginated product routes", async () => {
  const serverSource = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../scripts/server.js", import.meta.url), "utf8"));

  assert.match(serverSource, /from "\.\/lib\/product-listing\.js"/);
  assert.match(serverSource, /url\.pathname === "\/api\/repositories"/);
  assert.match(serverSource, /await listRepositorySummaries\(/);
  assert.match(serverSource, /await listRepositoryProducts\(/);
  assert.match(serverSource, /normalizeProductPageParams/);
  assert.match(serverSource, /productDirsForRepository/);
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run:

```bash
node --test tests/product-listing.test.js
```

Expected: FAIL because `scripts/server.js` has not imported or used the new helpers.

- [ ] **Step 3: Import the helpers in `scripts/server.js`**

Add this import near the existing local imports:

```js
import {
  listRepositoryProducts,
  listRepositorySummaries,
  normalizeProductPageParams,
  productDirsForRepository,
} from "./lib/product-listing.js";
```

- [ ] **Step 4: Add `/api/repositories` and replace `/api/products` route body**

Replace the current `/api/products` route block:

```js
    if (request.method === "GET" && url.pathname === "/api/products") {
      sendJson(response, await listRepositories(url.searchParams.get("storeId") || ""));
      return;
    }
```

with:

```js
    if (request.method === "GET" && url.pathname === "/api/repositories") {
      sendJson(response, await listRepositorySummaries({
        productsDir,
        storeId: url.searchParams.get("storeId") || "",
        readProductSummary,
        buildRepositorySummary,
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/products") {
      const repositoryId = url.searchParams.get("repository") || "";
      if (!repositoryId) {
        sendJson(response, { error: "缺少仓库参数。" }, 400);
        return;
      }

      const params = normalizeProductPageParams({
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
        status: url.searchParams.get("status"),
        q: url.searchParams.get("q"),
      });
      const result = await listRepositoryProducts({
        productsDir,
        repositoryId,
        storeId: url.searchParams.get("storeId") || "",
        ...params,
        readProductSummary,
      });

      if (!result) return notFound(response);
      sendJson(response, result);
      return;
    }
```

- [ ] **Step 5: Keep legacy `listProducts` and `listRepositories` only if still used**

Run:

```bash
rg -n "listProducts|listRepositories\\(" scripts/server.js
```

Expected after route change: `listProducts` has no callers and `listRepositories` has no callers.

Delete these functions from `scripts/server.js`:

```js
async function listProducts(storeId = "") {
  const repositories = await listRepositories(storeId);
  return repositories.flatMap((repository) => repository.products);
}

async function listRepositories(storeId = "") {
  const repositories = await readPlatformRepositories(productsDir, "1688");
  const summaries = [];

  for (const repository of repositories) {
    const products = [];
    for (const productDir of repository.productDirs) {
      products.push(await readProductSummary(productDir.relativeDir, repository.id, storeId));
    }
    summaries.push(buildRepositorySummary(repository.id, repository.name, products));
  }

  return summaries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}
```

- [ ] **Step 6: Support repository upload expansion**

In `createUploadJob`, replace:

```js
  const productDirs = Array.isArray(body.productDirs) ? body.productDirs.map(String).filter(Boolean) : [];

  if (!body.all && !body.productDir && productDirs.length === 0) {
    sendJson(response, { error: "请选择一个商品目录，或选择全部上传。" }, 400);
    return;
  }
```

with:

```js
  const repository = cleanPathSegment(body.repository || "");
  let productDirs = Array.isArray(body.productDirs) ? body.productDirs.map(String).filter(Boolean) : [];
  if (!body.all && repository && productDirs.length === 0 && !body.productDir) {
    productDirs = await productDirsForRepository({ productsDir, repositoryId: repository });
  }

  if (!body.all && !body.productDir && productDirs.length === 0) {
    sendJson(response, { error: "请选择一个商品目录、仓库，或选择全部上传。" }, 400);
    return;
  }
```

Then replace the job `repository` property:

```js
    repository: body.all ? "" : repositoryFromProductDir(productDirs[0] || body.productDir || ""),
```

with:

```js
    repository: body.all ? "" : repository || repositoryFromProductDir(productDirs[0] || body.productDir || ""),
```

- [ ] **Step 7: Run focused tests**

Run:

```bash
node --test tests/product-listing.test.js
```

Expected: PASS.

- [ ] **Step 8: Commit Task 2**

```bash
git add scripts/server.js tests/product-listing.test.js
git commit -m "Expose paginated product APIs"
```

---

### Task 3: Update Repository Page Frontend

**Files:**
- Modify: `public/index.html`
- Modify: `tests/repository-dialog-ui.test.js`

**Interfaces:**
- Consumes from Task 2:
  - `/api/repositories`
  - `/api/products?repository=...&page=...&pageSize=...&status=...&q=...`
  - `POST /api/upload-jobs` with `{ repository }`
- Produces:
  - Upload page fetches only current repository page.
  - Repository dropdown still uses summary data.
  - Existing Noon operations workbench continues to render catalog rows.

- [ ] **Step 1: Add failing static UI tests**

Append this to `tests/repository-dialog-ui.test.js`:

```js
test("repository page loads summaries and product pages separately", () => {
  assert.match(html, /fetchJson\(params\.toString\(\) \? `\/api\/repositories\?\$\{params\}` : "\/api\/repositories"\)/);
  assert.match(html, /async function loadRepositoryProductPage/);
  assert.match(html, /\/api\/products\?\$\{productParams\}/);
  assert.match(html, /productPageState/);
  assert.match(html, /pagination:\s*productPageState\.pagination/);
  assert.doesNotMatch(html, /fetchJson\(params\.toString\(\) \? `\/api\/products\?\$\{params\}` : "\/api\/products"\)/);
});

test("repository upload sends repository id instead of current page product dirs", () => {
  assert.match(html, /startUploadJob\(\{\s*repository:\s*repository\.id/);
  assert.doesNotMatch(html, /startUploadJob\(\{\s*productDirs:\s*products\.map/);
});
```

- [ ] **Step 2: Run UI tests to verify they fail**

Run:

```bash
node --test tests/repository-dialog-ui.test.js
```

Expected: FAIL because the frontend still fetches `/api/products` as the summary endpoint and repository upload still uses `products.map(...)`.

- [ ] **Step 3: Add upload page state**

Near the current globals:

```js
      let lastRepositories = [];
      let lastNoonCatalogSync = { synced: false, mode: "global", rows: [] };
```

add:

```js
      let productPageState = {
        repositoryId: "",
        products: [],
        pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
        status: "all",
        q: "",
      };
```

- [ ] **Step 4: Change `refreshProducts()` to fetch repository summaries**

Replace this line in `refreshProducts()`:

```js
        const repositories = await fetchJson(params.toString() ? `/api/products?${params}` : "/api/products");
```

with:

```js
        const repositories = await fetchJson(params.toString() ? `/api/repositories?${params}` : "/api/repositories");
```

After `lastNoonCatalogSync = noonCatalogSync;`, add:

```js
        if (!activeRepositoryId && repositories[0]) activeRepositoryId = repositories[0].id;
        if (activeRepositoryId) {
          await loadRepositoryProductPage({
            repositoryId: activeRepositoryId,
            page: productPageState.repositoryId === activeRepositoryId ? productPageState.pagination.page : 1,
            pageSize: productPageState.pagination.pageSize || 20,
            status: productPageState.status,
            q: productPageState.q,
          });
        } else {
          productPageState = {
            repositoryId: "",
            products: [],
            pagination: { page: 1, pageSize: 20, totalItems: 0, totalPages: 1 },
            status: "all",
            q: "",
          };
        }
```

- [ ] **Step 5: Add `loadRepositoryProductPage`**

Add this function below `refreshProducts()`:

```js
      async function loadRepositoryProductPage({ repositoryId, page = 1, pageSize = 20, status = "all", q = "" } = {}) {
        if (!repositoryId) return;
        const productParams = new URLSearchParams();
        productParams.set("repository", repositoryId);
        productParams.set("page", String(page));
        productParams.set("pageSize", String(pageSize));
        if (uploadStoreId.value) productParams.set("storeId", uploadStoreId.value);
        if (status && status !== "all") productParams.set("status", status);
        if (q) productParams.set("q", q);
        const result = await fetchJson(`/api/products?${productParams}`);
        productPageState = {
          repositoryId,
          products: result.products || [],
          pagination: result.pagination || { page, pageSize, totalItems: 0, totalPages: 1 },
          status,
          q,
        };
      }
```

- [ ] **Step 6: Change `renderProductPage` to use server page products for upload mode**

Replace:

```js
        const repository = platformRepositories.find((item) => item.id === activeRepositoryId) || platformRepositories[0] || emptyRepository(activePlatformSource);
        const products = repository.products || [];
```

with:

```js
        const repository = platformRepositories.find((item) => item.id === activeRepositoryId) || platformRepositories[0] || emptyRepository(activePlatformSource);
        const products = isOperations
          ? (repository.products || [])
          : (productPageState.repositoryId === repository.id ? productPageState.products : []);
        const pagination = productPageState.repositoryId === repository.id
          ? productPageState.pagination
          : { page: 1, pageSize: 20, totalItems: repository.productCount || 0, totalPages: Math.max(1, Math.ceil((repository.productCount || 0) / 20)) };
```

- [ ] **Step 7: Make repository selection fetch page one**

Replace the repository select listener body:

```js
          activeRepositoryId = event.currentTarget.value;
          renderProductPage(lastRepositories);
```

with:

```js
          activeRepositoryId = event.currentTarget.value;
          await loadRepositoryProductPage({ repositoryId: activeRepositoryId, page: 1, pageSize: pagination.pageSize || 20 });
          renderProductPage(lastRepositories, { rootEl, mode });
```

Make the listener callback `async`:

```js
        filterPanel.querySelector("[data-repository-source]")?.addEventListener("change", async (event) => {
```

- [ ] **Step 8: Make status filter and search fetch server pages**

In the status filter listener, replace:

```js
            statusFilter = button.dataset.statusFilter;
            currentPage = 1;
            filterPanel.querySelectorAll("[data-status-filter]").forEach((item) => item.classList.toggle("active", item === button));
            renderPage();
```

with:

```js
            statusFilter = button.dataset.statusFilter;
            currentPage = 1;
            filterPanel.querySelectorAll("[data-status-filter]").forEach((item) => item.classList.toggle("active", item === button));
            if (!isOperations) {
              await loadRepositoryProductPage({ repositoryId: repository.id, page: 1, pageSize, status: statusFilter, q: keyword });
              renderProductPage(lastRepositories, { rootEl, mode });
              return;
            }
            renderPage();
```

Make the callback `async`.

In the search input listener, debounce is not needed for this first pass. Replace the body with:

```js
            keyword = event.currentTarget.value.trim().toLowerCase();
            currentPage = 1;
            await loadRepositoryProductPage({ repositoryId: repository.id, page: 1, pageSize, status: statusFilter, q: keyword });
            renderProductPage(lastRepositories, { rootEl, mode });
```

Make the callback `async`.

- [ ] **Step 9: Make pager fetch server pages for upload mode**

In the `[data-page-target]` click handler, replace:

```js
          currentPage = Number(button.dataset.pageTarget);
          renderPage();
```

with:

```js
          currentPage = Number(button.dataset.pageTarget);
          if (!isOperations) {
            await loadRepositoryProductPage({ repositoryId: repository.id, page: currentPage, pageSize, status: statusFilter, q: keyword });
            renderProductPage(lastRepositories, { rootEl, mode });
            return;
          }
          renderPage();
```

Make the handler `async`.

In the `[data-page-size]` change handler, replace:

```js
          pageSize = Number(event.target.value) || pageSize;
          currentPage = 1;
          renderPage();
```

with:

```js
          pageSize = Number(event.target.value) || pageSize;
          currentPage = 1;
          if (!isOperations) {
            await loadRepositoryProductPage({ repositoryId: repository.id, page: 1, pageSize, status: statusFilter, q: keyword });
            renderProductPage(lastRepositories, { rootEl, mode });
            return;
          }
          renderPage();
```

Make the handler `async`.

- [ ] **Step 10: Use server pagination totals in `renderPage`**

In `renderPage()`, replace:

```js
          const visibleProducts = filteredProducts();
          const totalPages = Math.max(1, Math.ceil(visibleProducts.length / pageSize));
          currentPage = Math.min(Math.max(currentPage, 1), totalPages);
          const start = (currentPage - 1) * pageSize;
          const pageProducts = visibleProducts.slice(start, start + pageSize);
```

with:

```js
          const visibleProducts = filteredProducts();
          const serverPagination = !isOperations ? pagination : null;
          const totalPages = serverPagination ? serverPagination.totalPages : Math.max(1, Math.ceil(visibleProducts.length / pageSize));
          currentPage = serverPagination ? serverPagination.page : Math.min(Math.max(currentPage, 1), totalPages);
          pageSize = serverPagination ? serverPagination.pageSize : pageSize;
          const start = serverPagination ? (currentPage - 1) * pageSize : (currentPage - 1) * pageSize;
          const pageProducts = serverPagination ? visibleProducts : visibleProducts.slice(start, start + pageSize);
```

Then replace the pager render call:

```js
            totalItems: visibleProducts.length,
```

with:

```js
            totalItems: serverPagination ? serverPagination.totalItems : visibleProducts.length,
```

- [ ] **Step 11: Change repository upload payload**

Replace:

```js
            await startUploadJob({ productDirs: products.map((product) => product.dirName) });
```

with:

```js
            await startUploadJob({ repository: repository.id });
```

- [ ] **Step 12: Run UI tests**

Run:

```bash
node --test tests/repository-dialog-ui.test.js
```

Expected: PASS.

- [ ] **Step 13: Commit Task 3**

```bash
git add public/index.html tests/repository-dialog-ui.test.js
git commit -m "Load repository products by page"
```

---

### Task 4: Full Verification

**Files:**
- No planned source edits.
- Use: `package.json`
- Use: `docs/superpowers/specs/2026-07-05-products-pagination-design.md`

**Interfaces:**
- Consumes all tasks.
- Produces verified local behavior and a concise final report.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/product-listing.test.js tests/repository-dialog-ui.test.js
```

Expected: PASS.

- [ ] **Step 2: Run full test suite**

Run:

```bash
npm test
```

Expected: PASS.

- [ ] **Step 3: Start the local UI server**

Run:

```bash
npm run ui
```

Expected output includes:

```text
Noon tools UI: http://localhost:4173
```

Keep this process running for the next checks.

- [ ] **Step 4: Verify API response shape with curl**

In another terminal, run:

```bash
curl -s http://127.0.0.1:4173/api/repositories | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const json=JSON.parse(d); console.log({repositories:json.length, hasProducts:Object.prototype.hasOwnProperty.call(json[0]||{},"products")});})'
```

Expected:

```text
{ repositories: 2, hasProducts: false }
```

Then run, replacing `default` with an actual repository ID if needed:

```bash
curl -s 'http://127.0.0.1:4173/api/products?repository=default&page=1&pageSize=20' | node -e 'let d="";process.stdin.on("data",c=>d+=c);process.stdin.on("end",()=>{const json=JSON.parse(d); console.log({products:json.products.length, page:json.pagination.page, pageSize:json.pagination.pageSize, totalItems:json.pagination.totalItems});})'
```

Expected:

```text
{ products: 20, page: 1, pageSize: 20, totalItems: <repository product count> }
```

- [ ] **Step 5: Manual browser check**

Open:

```text
http://127.0.0.1:4173
```

Verify:

- The repository count and product count metrics render.
- The repository dropdown shows repositories.
- The product table shows the first page.
- Pager next page loads another `/api/products?...page=2...` request.
- Status filter and search send `/api/products` requests with `status` and `q`.
- Single product upload still sends `productDir`.
- Repository upload sends `repository`.
- Noon workbench still shows the SKU sync panel and does not depend on local product page data.

- [ ] **Step 6: Stop the local UI server**

Use `Ctrl-C` in the terminal running `npm run ui`.

Expected: server exits cleanly.

- [ ] **Step 7: Commit verification-only fixes if any**

If verification exposed a small fix, commit it:

```bash
git add scripts/lib/product-listing.js tests/product-listing.test.js scripts/server.js public/index.html tests/repository-dialog-ui.test.js
git commit -m "Fix product pagination verification issues"
```

If no fixes were needed, do not create an empty commit.

---

## Self-Review

- Spec coverage: The plan covers separated repository summaries, paginated product list API, server-side status/search filtering, page defaults and maximums, repository upload expansion, frontend endpoint changes, Noon Catalog non-goal preservation, and manual verification.
- Red-flag wording scan: No vague deferred work is left for implementers; each task lists exact files, function names, commands, and expected outcomes.
- Type consistency: `repositoryId`, `page`, `pageSize`, `status`, `q`, `products`, and `pagination` are named consistently across the library, server route, frontend state, and tests.
