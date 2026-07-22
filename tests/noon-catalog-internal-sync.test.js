import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  catalogRowsFromInternalHits,
  syncNoonCatalogFromInternalApi,
} from "../scripts/lib/noon-catalog-internal-sync.js";
import { readLatestNoonCatalogSync } from "../src/lib/noon-catalog-sync.ts";

test("syncNoonCatalogFromInternalApi defaults to 100 items per page", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-default-page-"));
  let request;
  await syncNoonCatalogFromInternalApi({
    rootDir,
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async (body) => {
        request = body;
        return { data: { total: 0, hits: [] } };
      },
      close: async () => {},
    }),
  });
  assert.equal(request.per_page, 100);
});

test("syncNoonCatalogFromInternalApi splits pages at the eight-request boundary", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-"));
  const requestedPages = [];
  let active = 0;
  let maxActive = 0;
  let completed = 0;
  let completedWhenPageTenStarted = null;
  let closed = false;
  const result = await syncNoonCatalogFromInternalApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    pageSize: 10,
    catalogUrl: "https://noon-catalog.noon.partners/en/catalog?project=PRJ517205",
    now: () => new Date("2026-07-12T00:00:00.000Z"),
    openSession: async () => ({
      finalUrl: "https://noon-catalog.noon.partners/en/catalog?project=PRJ517205",
      getStoreCode: async () => "STR517205-NSA",
      listOffers: async (request) => {
        const { page, per_page, noon_store_code } = request;
        requestedPages.push(request);
        if (page === 10) completedWhenPageTenStarted = completed;
        active += 1;
        maxActive = Math.max(maxActive, active);
        await new Promise((resolve) => setImmediate(resolve));
        active -= 1;
        completed += 1;
        const count = page === 10 ? 1 : 10;
        return { data: { total: 91, hits: Array.from({ length: count }, (_, index) => ({ partner_sku: `P-${page}-${index}`, zsku_child: `Z-${page}-${index}`, content: { title: `Item ${page}-${index}` } })) } };
      },
      close: async () => { closed = true; },
    }),
  });

  assert.deepEqual(requestedPages.map((item) => item.page).sort((a, b) => a - b), [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
  assert.ok(requestedPages.every((item) => item.per_page === 10));
  assert.ok(requestedPages.every((item) => item.noon_store_code === "STR517205-NSA"));
  assert.ok(requestedPages.every((item) => item.filters && !Array.isArray(item.filters) && Object.keys(item.filters).length === 0));
  assert.ok(requestedPages.every((item) => item.sort === ""));
  assert.ok(requestedPages.every((item) => item.direction === ""));
  assert.equal(maxActive, 8);
  assert.equal(completedWhenPageTenStarted, 9);
  assert.equal(result.rowCount, 91);
  assert.equal(result.finalUrl, "https://noon-catalog.noon.partners/en/catalog?project=PRJ517205");
  assert.equal(closed, true);
  const snapshot = JSON.parse(await readFile(path.join(rootDir, result.output), "utf8"));
  assert.equal(snapshot.rows.length, 91);
});

test("syncNoonCatalogFromInternalApi rejects a changed total instead of writing an incomplete snapshot", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-changing-total-"));
  const requestedPages = [];
  await assert.rejects(() => syncNoonCatalogFromInternalApi({
    rootDir,
    storeId: "PRJ517205",
    pageSize: 2,
    concurrency: 1,
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async ({ page }) => {
        requestedPages.push(page);
        if (page === 1) return { data: { total: 3, hits: [{ partner_sku: "1" }, { partner_sku: "2" }] } };
        if (page === 2) return { data: { total: 5, hits: [{ partner_sku: "3" }, { partner_sku: "4" }] } };
        return { data: { total: 5, hits: [{ partner_sku: "5" }] } };
      },
      close: async () => {},
    }),
  }), /第 2 页总数发生变化/);

  assert.deepEqual(requestedPages, [1, 2]);
});

test("syncNoonCatalogFromInternalApi identifies the Noon page-100 result window", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-result-window-"));
  await assert.rejects(() => syncNoonCatalogFromInternalApi({
    rootDir,
    pageSize: 1,
    concurrency: 99,
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async ({ page }) => page === 100
        ? { data: { total: 0, hits: [] } }
        : { data: { total: 100, hits: [{ partner_sku: String(page) }] } },
      close: async () => {},
    }),
  }), /分页窗口上限.*导出同步/);
});

test("syncNoonCatalogFromInternalApi retries HTTP 429 with bounded backoff", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-rate-limit-"));
  const delays = [];
  let attempts = 0;
  const result = await syncNoonCatalogFromInternalApi({
    rootDir,
    sleep: async (delay) => delays.push(delay),
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async () => {
        attempts += 1;
        if (attempts < 3) throw new Error("Noon Offer 请求失败：HTTP 429");
        return { data: { total: 1, hits: [{ partner_sku: "1" }] } };
      },
      close: async () => {},
    }),
  });

  assert.equal(result.rowCount, 1);
  assert.equal(attempts, 3);
  assert.deepEqual(delays, [1000, 2000]);
});

test("syncNoonCatalogFromInternalApi stops after five HTTP 429 attempts", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-rate-limit-limit-"));
  const delays = [];
  let attempts = 0;
  await assert.rejects(() => syncNoonCatalogFromInternalApi({
    rootDir,
    sleep: async (delay) => delays.push(delay),
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async () => {
        attempts += 1;
        throw new Error("Noon Offer 请求失败：HTTP 429");
      },
      close: async () => {},
    }),
  }), /HTTP 429/);

  assert.equal(attempts, 5);
  assert.deepEqual(delays, [1000, 2000, 4000, 8000]);
});

test("syncNoonCatalogFromInternalApi maps a real Noon hit shape through the snapshot reader", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-real-hit-"));
  const hit = {
    partner_sku: "",
    zsku_child: "",
    psku_code: "PC-1",
    catalog_sku: "CAT-1",
    content: { title: "Gold Bag", image: "https://img.test/gold.jpg" },
    price: 12,
    currency: "AED",
    fbn_stock: 4,
    fbp_stock: 7,
    offer_issues: ["missing_barcode", "low_content"],
    live_status: "live",
    seller_status: "active",
  };
  await syncNoonCatalogFromInternalApi({
    rootDir, storeId: "PRJ517205", mode: "global",
    now: () => new Date("2026-07-12T01:00:00.000Z"),
    openSession: async () => ({
      finalUrl: "https://noon-catalog.noon.partners/en/catalog?project=PRJ517205",
      getStoreCode: async () => "STR517205-NSA",
      listOffers: async () => ({ data: { total: 2, hits: [hit, { ...hit }] } }),
      close: async () => {},
    }),
  });
  const sync = await readLatestNoonCatalogSync({ rootDir, storeId: "PRJ517205", mode: "global" });
  assert.equal(sync.rows.length, 1);
  assert.deepEqual(sync.rows[0], {
    cells: ["Gold Bag PSKU: PC-1 SKU: CAT-1", "AED 12", "FBN: 4, FBP: 7", "-", "Issues: missing_barcode, low_content; Live: live; Seller: active"],
    imageUrl: "https://img.test/gold.jpg", title: "Gold Bag", psku: "PC-1", sku: "CAT-1",
    price: "AED 12", inventory: "FBN: 4, FBP: 7", issues: "Issues: missing_barcode, low_content; Live: live; Seller: active",
  });
});

test("catalogRowsFromInternalHits keeps legacy field fallbacks readable", () => {
  assert.deepEqual(catalogRowsFromInternalHits([{
    partner_sku: "P-1", zsku_child: "Z-1",
    content: { title: "Legacy Bag", image_url: "https://img.test/legacy.jpg" },
    offer_price: "AED 9", stock: 2, status: "live",
  }]), [{ cells: ["Legacy Bag PSKU: P-1 SKU: Z-1", "AED 9", "2", "-", "live"], imageUrl: "https://img.test/legacy.jpg" }]);
});

test("catalogRowsFromInternalHits preserves separate hits without stable identifiers", () => {
  const rows = catalogRowsFromInternalHits([
    { content: { title: "Unknown One" } },
    { content: { title: "Unknown Two" } },
  ]);
  assert.equal(rows.length, 2);
});

test("syncNoonCatalogFromInternalApi rejects an incomplete middle page before writing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-incomplete-"));
  await assert.rejects(() => syncNoonCatalogFromInternalApi({
    rootDir,
    storeId: "PRJ517205",
    pageSize: 2,
    openSession: async () => ({
      getStoreCode: async () => "STR",
      listOffers: async ({ page }) => ({ data: { total: 5, hits: page === 1 ? [{ partner_sku: "1" }, { partner_sku: "2" }] : page === 2 ? [] : [{ partner_sku: "5" }] } }),
      close: async () => {},
    }),
  }), /第 2 页数据不完整/);
});

test("syncNoonCatalogFromInternalApi does not log page 1 of 0 for an empty catalog", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-empty-"));
  const lines = [];
  const originalLog = console.log;
  console.log = (line) => lines.push(String(line));
  try {
    await syncNoonCatalogFromInternalApi({ rootDir, storeId: "PRJ517205", openSession: async () => ({
      getStoreCode: async () => "STR", listOffers: async () => ({ data: { total: 0, hits: [] } }), close: async () => {},
    }) });
  } finally {
    console.log = originalLog;
  }
  assert.ok(lines.length > 0);
  assert.ok(lines.every((line) => !line.includes("第 1/0 页")));
});

for (const [name, session, pattern] of [
  ["rejects an empty noon_store_code", { getStoreCode: async () => "", listOffers: async () => ({}) }, /找不到 Noon Store Code/],
  ["rejects an equivalent non-2xx error", { getStoreCode: async () => "STR", listOffers: async () => { throw new Error("HTTP 500"); } }, /HTTP 500/],
  ["rejects a payload without data.total", { getStoreCode: async () => "STR", listOffers: async () => ({ data: { hits: [] } }) }, /data\.total/],
  ["rejects a negative data.total", { getStoreCode: async () => "STR", listOffers: async () => ({ data: { total: -1, hits: [] } }) }, /data\.total/],
  ["rejects a fractional data.total", { getStoreCode: async () => "STR", listOffers: async () => ({ data: { total: 1.5, hits: [] } }) }, /data\.total/],
  ["rejects a payload without data.hits", { getStoreCode: async () => "STR", listOffers: async () => ({ data: { total: 0 } }) }, /data\.hits/],
]) {
  test(`syncNoonCatalogFromInternalApi ${name} and closes the session`, async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-internal-error-"));
    let closed = false;
    await assert.rejects(() => syncNoonCatalogFromInternalApi({
      rootDir,
      storeId: "PRJ517205",
      mode: "global",
      catalogUrl: "https://catalog.test",
      openSession: async () => ({ ...session, finalUrl: "https://catalog.test/final", close: async () => { closed = true; } }),
    }), pattern);
    assert.equal(closed, true);
  });
}
