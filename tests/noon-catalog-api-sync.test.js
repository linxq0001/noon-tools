import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { readLatestNoonCatalogSync } from "../src/lib/noon-catalog-sync.ts";
import { syncNoonCatalogFromApi } from "../scripts/lib/noon-catalog-api-sync.js";

const createUrl = "https://noon-api-gateway.noon.partners/impex/v1/export/create";
const statusUrl = "https://noon-api-gateway.noon.partners/impex/v1/export/status";
const downloadUrl = "https://download.test/catalog.csv";

function exportResponse(url, csv = "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\nDefault Item,P-1,Z-1,AED 1,0,ACTIVE\n") {
  if (url === createUrl) return new Response(JSON.stringify({ export_code: "export-1" }), { status: 200 });
  if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
  if (url === downloadUrl) return new Response(csv, { status: 200 });
  throw new Error(`Unexpected URL: ${url}`);
}

test("syncNoonCatalogFromApi rejects an export that parses to zero rows", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-empty-export-"));
  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    fetchImpl: async (url) => exportResponse(url, "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\n"),
  }), /未解析出 SKU.*text\/plain.*bytes=/);
});

test("syncNoonCatalogFromApi rejects unrecognized export headers", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-headers-"));
  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    fetchImpl: async (url) => exportResponse(url, "unknown_one,unknown_two\nvalue-one,value-two\n"),
  }), /无法识别 SKU 表头.*unknown_one.*unknown_two/);
});

test("syncNoonCatalogFromApi writes catalog snapshot from Noon catalog export", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-"));
  const requests = [];

  const result = await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    token: "plain-token",
    baseUrl: "https://api.test",
    now: () => new Date("2026-07-09T00:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, authorization: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
      return exportResponse(url, "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\nGold Bag,G-1001,ZSKU-1001,AED 12.00,4,ACTIVE\n");
    },
  });

  const snapshot = JSON.parse(await readFile(path.join(rootDir, result.output), "utf8"));
  assert.equal(requests[0].url, createUrl);
  assert.equal(requests[0].authorization, "Bearer plain-token");
  assert.deepEqual(requests[0].body, {
    export_category_code: "noon_catalog_globalcatalogexport",
    params: { country: "sa", noon_status: "live" },
  });
  assert.equal(requests[1].url, statusUrl);
  assert.deepEqual(requests[1].body, { export_code: "export-1" });
  assert.equal(requests[2].url, downloadUrl);
  assert.equal(result.rowCount, 1);
  assert.equal(snapshot.storeId, "PRJ517205");
  assert.equal(snapshot.mode, "global");
  assert.deepEqual(snapshot.rows, [
    {
      cells: ["Gold Bag PSKU: G-1001 SKU: ZSKU-1001", "AED 12.00", "4", "", "ACTIVE"],
      imageUrl: "",
    },
  ]);

  const sync = await readLatestNoonCatalogSync({ rootDir, storeId: "PRJ517205", mode: "global" });
  assert.equal(sync.synced, true);
  assert.equal(sync.rows[0].psku, "G-1001");
  assert.equal(sync.rows[0].sku, "ZSKU-1001");
  assert.equal(sync.rows[0].title, "Gold Bag");
});

test("syncNoonCatalogFromApi expands all into the three Noon status exports and merges them", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-all-statuses-"));
  const createdStatuses = [];
  let currentStatus = "";
  const result = await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "all",
    fetchImpl: async (url, init = {}) => {
      if (url === createUrl) {
        currentStatus = JSON.parse(init.body).params.noon_status;
        createdStatuses.push(currentStatus);
        return new Response(JSON.stringify({ export_code: `export-${currentStatus}` }), { status: 200 });
      }
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: `${downloadUrl}?status=${currentStatus}` }), { status: 200 });
      if (String(url).startsWith(downloadUrl)) {
        return new Response(`noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\n${currentStatus},P-${currentStatus},Z-${currentStatus},1,0,${currentStatus}\n`, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.deepEqual(createdStatuses, ["live", "not_live", "no_global_offer"]);
  assert.equal(result.rowCount, 3);
});

test("syncNoonCatalogFromApi deduplicates the same SKU even when titles change between exports", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-dedupe-"));
  let currentStatus = "";
  const result = await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "all",
    fetchImpl: async (url, init = {}) => {
      if (url === createUrl) {
        currentStatus = JSON.parse(init.body).params.noon_status;
        return new Response(JSON.stringify({ export_code: `export-${currentStatus}` }), { status: 200 });
      }
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
      if (url === downloadUrl) return new Response(`noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\n${currentStatus} title,P-SAME,Z-SAME,1,0,${currentStatus}\n`, { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(result.rowCount, 1);
});

test("syncNoonCatalogFromApi rejects export rows without a stable SKU", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-missing-sku-"));
  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    fetchImpl: async (url) => exportResponse(url, "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\nLong product title,,,1,0,live\n"),
  }), /数据行缺少 PSKU 和 SKU/);
});

test("syncNoonCatalogFromApi rejects malformed quoted CSV rows", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-malformed-csv-"));
  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    fetchImpl: async (url) => exportResponse(url, "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\n\"broken title,P-1,Z-1,1,0,live\n"),
  }), /CSV 引号未闭合/);
});

test("syncNoonCatalogFromApi reads a streamed export response", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-stream-"));
  const encoder = new TextEncoder();
  const chunks = [
    "noon_title,partner_sku,sku_child,price,stock_fbn_net,noon_status\n",
    "Streamed Item,P-STREAM,Z-STREAM,5,2,live\n",
  ];

  const result = await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    fetchImpl: async (url) => {
      if (url === createUrl) return new Response(JSON.stringify({ export_code: "export-stream" }), { status: 200 });
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
      if (url === downloadUrl) {
        return new Response(new ReadableStream({
          pull(controller) {
            const chunk = chunks.shift();
            if (chunk === undefined) controller.close();
            else controller.enqueue(encoder.encode(chunk));
          },
        }), { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  assert.equal(result.rowCount, 1);
});

test("syncNoonCatalogFromApi aborts a stalled export download", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-stalled-"));

  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    downloadIdleTimeoutMs: 20,
    fetchImpl: async (url) => {
      if (url === createUrl) return new Response(JSON.stringify({ export_code: "export-stalled" }), { status: 200 });
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
      if (url === downloadUrl) return new Response(new ReadableStream({ pull() {} }), { status: 200 });
      throw new Error(`Unexpected URL: ${url}`);
    },
  }), /下载超过 20 毫秒未收到新数据/);
});

test("syncNoonCatalogFromApi aborts while waiting for export download headers", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-stalled-headers-"));
  const syncPromise = syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    downloadIdleTimeoutMs: 20,
    fetchImpl: async (url, init = {}) => {
      if (url === createUrl) return new Response(JSON.stringify({ export_code: "export-stalled-headers" }), { status: 200 });
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
      if (url === downloadUrl) {
        return new Promise((_, reject) => init.signal.addEventListener("abort", () => reject(init.signal.reason), { once: true }));
      }
      throw new Error(`Unexpected URL: ${url}`);
    },
  });

  await assert.rejects(Promise.race([
    syncPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error("test guard timeout")), 100)),
  ]), /下载请求超过 20 毫秒未收到响应/);
});

test("syncNoonCatalogFromApi cancels a stalled non-stream download", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-array-buffer-timeout-"));
  let cancelled = false;
  await assert.rejects(() => syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    token: "plain-token",
    noonStatus: "live",
    downloadIdleTimeoutMs: 20,
    fetchImpl: async (url) => {
      if (url === createUrl) return new Response(JSON.stringify({ export_code: "export-array-buffer" }), { status: 200 });
      if (url === statusUrl) return new Response(JSON.stringify({ export_status: "COMPLETE", download_url: downloadUrl }), { status: 200 });
      if (url === downloadUrl) return {
        ok: true,
        headers: new Headers(),
        body: { cancel: async () => { cancelled = true; } },
        arrayBuffer: () => new Promise(() => {}),
      };
      throw new Error(`Unexpected URL: ${url}`);
    },
  }), /下载超过 20 毫秒未收到新数据/);
  assert.equal(cancelled, true);
});

test("syncNoonCatalogFromApi reads NOON_API_TOKEN from local env files", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-env-"));
  await writeFile(path.join(rootDir, ".env.local"), "NOON_API_BASE_URL=https://api.env-test\nNOON_API_TOKEN=env-token\n", "utf8");
  const requests = [];

  await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    now: () => new Date("2026-07-09T00:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, authorization: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
      return exportResponse(url);
    },
  });

  assert.equal(requests[0].url, createUrl);
  assert.equal(requests[0].authorization, "Bearer env-token");
  assert.equal(requests[1].url, statusUrl);
});

test("syncNoonCatalogFromApi prefers the selected store API token", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-store-token-"));
  await writeFile(path.join(rootDir, ".noon-stores.json"), JSON.stringify({
    stores: [
      { id: "PRJ517205", name: "Main", projectId: "PRJ517205", apiToken: "store-token", createdAt: "2026-07-09T00:00:00.000Z" },
    ],
  }), "utf8");
  const requests = [];

  await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    token: "wrong-token",
    now: () => new Date("2026-07-09T00:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, authorization: init.headers?.authorization, body: init.body ? JSON.parse(init.body) : null });
      return exportResponse(url);
    },
  });

  assert.equal(requests[0].authorization, "Bearer store-token");
  assert.equal(requests[0].url, createUrl);
  assert.equal(requests[1].url, statusUrl);
});

test("syncNoonCatalogFromApi signs APIJWT credentials stored on a store", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-store-apijwt-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJ517205",
    type: "apijwt",
  };
  await writeFile(path.join(rootDir, ".noon-stores.json"), JSON.stringify({
    stores: [
      { id: "PRJ517205", name: "Main", projectId: "PRJ517205", apiToken: JSON.stringify(credential), createdAt: "2026-07-09T00:00:00.000Z" },
    ],
  }), "utf8");
  const requests = [];

  await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    now: () => new Date("2026-07-09T00:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({
        url,
        method: init.method,
        authorization: init.headers?.authorization,
        body: init.body ? JSON.parse(init.body) : null,
      });
      if (url.endsWith("/public/v1/api/login")) return new Response(JSON.stringify({ ok: true }), { status: 200 });
      return exportResponse(url);
    },
  });

  assert.equal(requests[0].url, "https://noon-api-gateway.noon.partners/identity/public/v1/api/login");
  assert.equal(requests[0].method, "POST");
  assert.match(requests[0].body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(requests[0].body.default_project_code, "PRJ517205");
  assert.equal(requests[1].url, createUrl);
  assert.deepEqual(requests[1].body, {
    export_category_code: "noon_catalog_globalcatalogexport",
    params: { country: "sa", noon_status: "live" },
  });
  assert.equal(requests[2].url, statusUrl);
});

test("syncNoonCatalogFromApi logs in APIJWT credentials before catalog requests", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-login-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJ517205",
    type: "apijwt",
  };
  const requests = [];

  await syncNoonCatalogFromApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    token: JSON.stringify(credential),
    now: () => new Date("2026-07-09T00:00:00.000Z"),
    fetchImpl: async (url, init = {}) => {
      requests.push({ url, method: init.method, cookie: init.headers?.cookie || "", body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/public/v1/api/login")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "set-cookie": "sid=session-1; Path=/; HttpOnly" },
        });
      }
      return exportResponse(url);
    },
  });

  assert.equal(requests[0].url, "https://noon-api-gateway.noon.partners/identity/public/v1/api/login");
  assert.equal(requests[0].method, "POST");
  assert.match(requests[0].body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(requests[0].body.default_project_code, "PRJ517205");
  assert.equal(requests[1].url, createUrl);
  assert.equal(requests[1].cookie, "sid=session-1");
  assert.deepEqual(requests[1].body, {
    export_category_code: "noon_catalog_globalcatalogexport",
    params: { country: "sa", noon_status: "live" },
  });
  assert.equal(requests[2].url, statusUrl);
  assert.equal(requests[2].cookie, "sid=session-1");
  assert.deepEqual(requests[2].body, { export_code: "export-1" });
});

test("syncNoonCatalogFromApi explains Noon gateway fault filter abort", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-catalog-api-fault-"));
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJ517205",
    type: "apijwt",
  };

  await assert.rejects(
    () => syncNoonCatalogFromApi({
      rootDir,
      storeId: "PRJ517205",
      mode: "global",
      token: JSON.stringify(credential),
      fetchImpl: async () => new Response("fault filter abort", { status: 418, statusText: "I'm a teapot" }),
    }),
    /Noon 网关拒绝请求.*noon-api-gateway\.noon\.partners.*Project Owner/,
  );
});
