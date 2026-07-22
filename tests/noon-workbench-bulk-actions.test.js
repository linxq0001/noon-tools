import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { noonApiRequest } from "../src/lib/noon-api-client.ts";
import { applyNoonWorkbenchBulkAction, resolveProductDirsForSkus } from "../src/lib/noon-workbench-bulk-actions.ts";

test("resolveProductDirsForSkus maps selected Noon SKUs to local product dirs", async () => {
  const { rootDir } = await createProduct();

  const result = await resolveProductDirsForSkus({ rootDir, skus: ["G-1001-1001-GOLD"] });

  assert.deepEqual(result.productDirs, ["1688/default/1001"]);
  assert.deepEqual(result.unresolvedSkus, []);
});

test("applyNoonWorkbenchBulkAction calls pricing upsert for selected countries", async () => {
  const calls = [];

  const result = await applyNoonWorkbenchBulkAction({
    items: [{ partner_sku: "G-1001-1001-GOLD", zsku_child: "ZSKU-1" }],
    operation: { type: "set_price", countryCodes: "ae,sa", price: "19.5" },
    apiOptions: mockApiOptions(calls),
  });

  assert.equal(result.changedCount, 2);
  assert.equal(calls[0].url, "https://api.test/v1/pricing/upsert");
  assert.deepEqual(calls[0].body, {
    items: [
      { partner_sku: "G-1001-1001-GOLD", country_code: "ae", price: 19.5 },
      { partner_sku: "G-1001-1001-GOLD", country_code: "sa", price: 19.5 },
    ],
  });
});

test("applyNoonWorkbenchBulkAction calls product upsert for supported product attributes", async () => {
  const calls = [];

  const result = await applyNoonWorkbenchBulkAction({
    items: [{ partner_sku: "G-1001-1001-GOLD" }],
    operation: { type: "set_attribute", field: "hs_code", value: "420222" },
    apiOptions: mockApiOptions(calls),
  });

  assert.equal(result.changedCount, 1);
  assert.equal(calls[0].url, "https://api.test/v1/product/upsert");
  assert.deepEqual(calls[0].body, { items: [{ partner_sku: "G-1001-1001-GOLD", hs_code: "420222" }] });
});

test("applyNoonWorkbenchBulkAction calls stock update with local warehouse code", async () => {
  const { rootDir } = await createProduct();
  const calls = [];

  const result = await applyNoonWorkbenchBulkAction({
    rootDir,
    items: [{ partner_sku: "G-1001-1001-GOLD" }],
    operation: { type: "set_stock", stock: "9" },
    apiOptions: mockApiOptions(calls),
  });

  assert.equal(result.changedCount, 1);
  assert.equal(calls[0].url, "https://api.test/v1/stock-update");
  assert.deepEqual(calls[0].body, { items: [{ warehouse_code: "WH-AE", partner_sku: "G-1001-1001-GOLD", qty: 9 }] });
});

test("applyNoonWorkbenchBulkAction calls stock update for processing time", async () => {
  const calls = [];

  const result = await applyNoonWorkbenchBulkAction({
    items: [{ partner_sku: "G-1001-1001-GOLD", warehouse_code: "WH-SA" }],
    operation: { type: "set_processing_time", processingTime: "2_days" },
    apiOptions: mockApiOptions(calls),
  });

  assert.equal(result.changedCount, 1);
  assert.equal(calls[0].url, "https://api.test/v1/stock-update");
  assert.deepEqual(calls[0].body, { items: [{ warehouse_code: "WH-SA", partner_sku: "G-1001-1001-GOLD", processing_time: "2_days" }] });
});

test("applyNoonWorkbenchBulkAction calls child SKU delete", async () => {
  const calls = [];

  const result = await applyNoonWorkbenchBulkAction({
    items: [{ partner_sku: "G-1001-1001-GOLD", zsku_child: "ZSKU-1" }],
    operation: { type: "delete_products" },
    apiOptions: mockApiOptions(calls),
  });

  assert.equal(result.changedCount, 1);
  assert.equal(calls[0].url, "https://api.test/v1/sku/child/delete");
  assert.deepEqual(calls[0].body, { items: [{ partner_sku: "G-1001-1001-GOLD", zsku_child: "ZSKU-1" }] });
});

test("applyNoonWorkbenchBulkAction requires Noon API token", async () => {
  await assert.rejects(
    () => applyNoonWorkbenchBulkAction({
      items: [{ partner_sku: "G-1001-1001-GOLD" }],
      operation: { type: "set_attribute", field: "hs_code", value: "420222" },
      apiOptions: { token: "", baseUrl: "https://api.test", fetchImpl: async () => new Response("{}") },
    }),
    /NOON_API_TOKEN/,
  );
});

test("noonApiRequest signs apijwt JSON credentials before login", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJTEST",
    type: "apijwt",
  };
  const calls = [];

  await noonApiRequest("/v1/whoami", undefined, {
    token: JSON.stringify(credential),
    baseUrl: "https://api.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/public/v1/api/login")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "set-cookie": "sid=session-1; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(calls[0].url, "https://api.test/public/v1/api/login");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  const payload = JSON.parse(Buffer.from(calls[0].body.token.split(".")[1], "base64url").toString("utf8"));
  assert.equal(payload.sub, "noon-partners-key-id-test");
  assert.equal(typeof payload.jti, "string");
});

test("noonApiRequest logs in apijwt JSON credentials before business requests", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJTEST",
    type: "apijwt",
  };
  const calls = [];

  await noonApiRequest("/v1/whoami", undefined, {
    token: JSON.stringify(credential),
    baseUrl: "https://api.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, method: init.method, cookie: init.headers.cookie || "", body: init.body ? JSON.parse(init.body) : null });
      if (url.endsWith("/public/v1/api/login")) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { "set-cookie": "sid=session-1; Path=/; HttpOnly" },
        });
      }
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(calls[0].url, "https://api.test/public/v1/api/login");
  assert.equal(calls[0].method, "POST");
  assert.match(calls[0].body.token, /^[^.]+\.[^.]+\.[^.]+$/);
  assert.equal(calls[0].body.default_project_code, "PRJTEST");
  assert.equal(calls[1].url, "https://api.test/v1/whoami");
  assert.equal(calls[1].cookie, "sid=session-1");
});

test("noonApiRequest routes default business endpoints through the documented gateway prefixes", async () => {
  const calls = [];

  await Promise.all([
    noonApiRequest("/v1/pricing/upsert", { items: [] }, {
      token: "plain-token",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
    noonApiRequest("/v1/stock-update", { items: [] }, {
      token: "plain-token",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
    noonApiRequest("/v1/product/upsert", { items: [] }, {
      token: "plain-token",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
    noonApiRequest("/v1/sku/child/delete", { items: [] }, {
      token: "plain-token",
      fetchImpl: async (url) => {
        calls.push(String(url));
        return new Response(JSON.stringify({ items: [] }), { status: 200 });
      },
    }),
  ]);

  assert.deepEqual(calls.sort(), [
    "https://noon-api-gateway.noon.partners/catplat/v1/sku/child/delete",
    "https://noon-api-gateway.noon.partners/pricing/v1/pricing/upsert",
    "https://noon-api-gateway.noon.partners/stock/v1/stock-update",
    "https://noon-api-gateway.noon.partners/xborder-pricing/v1/product/upsert",
  ]);
});

test("noonApiRequest explains Noon gateway fault filter abort", async () => {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const credential = {
    key_id: "noon-partners-key-id-test",
    private_key: privateKey.export({ type: "pkcs8", format: "pem" }),
    project_code: "PRJTEST",
    type: "apijwt",
  };

  await assert.rejects(
    () => noonApiRequest("/v1/whoami", undefined, {
      token: JSON.stringify(credential),
      baseUrl: "https://api.test",
      fetchImpl: async () => new Response("fault filter abort", { status: 418, statusText: "I'm a teapot" }),
    }),
    /Noon 网关拒绝请求.*api.test.*Project Owner/,
  );
});

test("noonApiRequest keeps plain bearer tokens unchanged", async () => {
  let authorization = "";

  await noonApiRequest("/v1/whoami", undefined, {
    token: "plain-token",
    baseUrl: "https://api.test",
    fetchImpl: async (_url, init) => {
      authorization = String(init.headers.authorization);
      return new Response(JSON.stringify({ ok: true }), { status: 200 });
    },
  });

  assert.equal(authorization, "Bearer plain-token");
});

async function createProduct() {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-workbench-bulk-"));
  const productDir = "1688/default/1001";
  const fullProductDir = path.join(rootDir, "products", productDir);
  await mkdir(fullProductDir, { recursive: true });
  await writeFile(path.join(fullProductDir, "meta.json"), JSON.stringify({ title: "Gold Bag" }), "utf8");
  await writeFile(
    path.join(fullProductDir, "noon-product-attributes.json"),
    JSON.stringify({
      variants: [
        {
          partner_sku: "G-1001-1001-GOLD",
          model_number: "G-1001-1001-GOLD",
          barcode: "10010001",
          warehouse_code: "WH-AE",
        },
      ],
    }),
    "utf8",
  );
  return { rootDir, productDir };
}

function mockApiOptions(calls) {
  return {
    token: "test-token",
    baseUrl: "https://api.test",
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return new Response(JSON.stringify({ items: calls.at(-1).body.items.map((item) => ({ ...item, status: { status_code: "OK" } })) }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
}
