# noon Bulk Operations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the first-phase noon bulk operations workflow: pre-listing checks, profit calculation, bulk price/stock/deactivate updates, store-scoped upload status, export gating, API endpoints, and repository-page UI controls.

**Architecture:** Keep core behavior in small tested modules under `scripts/lib/`, then wire those modules into `scripts/server.js` and `public/index.html`. Local JSON files remain the source of truth; xlsx exports remain the external handoff format. UI changes are a thin layer over two new APIs: checks and bulk operations.

**Tech Stack:** Node.js ESM, `node:test`, local JSON files under `products/`, `xlsx`, existing static `public/index.html`, existing local HTTP server in `scripts/server.js`.

## Global Constraints

- 商品主数据继续使用 `products/<platform>/<repository>/<productId>/`。
- 当前平台继续以 `1688` 为主。
- `meta.json` 保存来源事实和本地素材事实。
- `noon-product-attributes.json` 保存 noon 目标商品数据。
- 上传和导出默认只处理通过本地技术校验的商品。
- `index.json` 是派生文件，不作为唯一事实来源。
- 不引入外部数据库；继续使用本地 JSON 和 xlsx 导出。
- 第一期不实现拼多多、Amazon、Noon 商品采集。
- 第一期不实现 FBN 7x24 自动抢仓或自动预约。
- 第一期不实现图搜商品、选品助手、完整 noon 后台中文化、直接自动删除 noon 后台商品、云同步、团队权限、远程数据库。
- 批量改时效第一期只写入本地运营字段；不进入现有 noon xlsx 模板。
- 店铺 ID 由用户手动输入，系统只做安全路径字符校验和重复校验。
- 利润计算的平台费率按店铺配置；未选择店铺时使用全局默认费率。

---

## File Structure

- Create `scripts/lib/noon-profit.js`
  - Pure profit math. No filesystem access.
  - Exports `calculateNoonProfit(input)` and `normalizeProfitConfig(config)`.

- Create `tests/noon-profit.test.js`
  - Covers suggested price, current-price profit, low-margin warning inputs, and invalid numeric values.

- Create `scripts/lib/noon-operation-checks.js`
  - Reads product JSON through passed objects or filesystem helpers.
  - Produces `blockingIssues`, `warnings`, `profit`, and variant-level summaries.
  - Exports `checkNoonProduct(input)`, `checkNoonProducts(input)`, and `normalizeOperationCheck(result)`.

- Create `tests/noon-operation-checks.test.js`
  - Covers missing files, missing required fields, duplicate SKU/barcode, image existence, low margin warnings, and clean products.

- Create `scripts/lib/noon-bulk-operations.js`
  - Applies confirmed bulk operations to `noon-product-attributes.json`.
  - Exports `applyBulkOperation(input)`.
  - Supports `set_price`, `set_stock`, `deactivate`, and `set_processing_time`.

- Create `tests/noon-bulk-operations.test.js`
  - Covers price update, stock update, deactivate, local processing time, blocking skip behavior, and summary counts.

- Modify `scripts/lib/noon-upload-status.js`
  - Keep old single-store status compatibility.
  - Add store-scoped status under `stores`.
  - Export `normalizeStoreId(storeId)`, `readStoreNoonUploadStatusFromProductDir(productDir, relativeDir, storeId)`, and `writeStoreNoonUploadStatus(productDir, status, storeId)`.

- Modify `tests/noon-upload-status.test.js`
  - Add store-scoped read/write tests while preserving current tests.

- Modify `scripts/lib/noon-bulk-update-exporter.js`
  - Skip products with operation check blocking issues by default.
  - Reflect `operation_status: "inactive"` as `is_active = "FALSE"` and stock `0`.
  - Return skipped products in the export result.

- Modify `tests/noon-bulk-update-exporter.test.js`
  - Add tests for blocking skip and inactive export rows.

- Modify `scripts/server.js`
  - Add `POST /api/operation-checks`.
  - Add `POST /api/bulk-operations`.
  - Extend settings sanitization to preserve store configuration JSON.
  - Include operation summaries and store upload status in product summaries.

- Modify `public/index.html`
  - Add repository dialog controls for store filter, operation checks, bulk price, bulk stock, deactivate, and local processing time.
  - Render check results and operation summaries in the existing repository log.

- Test all changed behavior with `npm test`.

---

### Task 1: Profit Calculation Module

**Files:**
- Create: `scripts/lib/noon-profit.js`
- Create: `tests/noon-profit.test.js`

**Interfaces:**
- Consumes: numeric-like input values from settings, `meta.json`, and variants.
- Produces:
  - `normalizeProfitConfig(config: object): { costCny: number, shippingCny: number, exchangeRate: number, platformFeeRate: number, targetMargin: number }`
  - `calculateNoonProfit(input: object): { suggestedPriceAed: number, estimatedProfitAed: number, margin: number, belowTarget: boolean, warnings: Array<{ code: string, message: string }> }`

- [ ] **Step 1: Write the failing tests**

Create `tests/noon-profit.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { calculateNoonProfit, normalizeProfitConfig } from "../scripts/lib/noon-profit.js";

test("calculateNoonProfit returns suggested price for target margin", () => {
  const result = calculateNoonProfit({
    costCny: 38,
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
  });

  assert.equal(result.suggestedPriceAed, 35.45);
  assert.equal(result.estimatedProfitAed, 9.93);
  assert.equal(result.margin, 0.28);
  assert.equal(result.belowTarget, false);
  assert.deepEqual(result.warnings, []);
});

test("calculateNoonProfit evaluates an existing sale price", () => {
  const result = calculateNoonProfit({
    costCny: 38,
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
    salePriceAed: 29,
  });

  assert.equal(result.suggestedPriceAed, 35.45);
  assert.equal(result.estimatedProfitAed, 3.55);
  assert.equal(result.margin, 0.12);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "low_margin",
      message: "毛利率 12% 低于目标利润率 28%。",
    },
  ]);
});

test("normalizeProfitConfig accepts numeric strings and defaults", () => {
  assert.deepEqual(
    normalizeProfitConfig({
      costCny: "38.5",
      shippingCny: "11.5",
      exchangeRate: "1.96",
      platformFeeRate: "12%",
      targetMargin: "28%",
    }),
    {
      costCny: 38.5,
      shippingCny: 11.5,
      exchangeRate: 1.96,
      platformFeeRate: 0.12,
      targetMargin: 0.28,
    },
  );
});

test("calculateNoonProfit reports invalid cost inputs", () => {
  const result = calculateNoonProfit({
    costCny: "",
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
  });

  assert.equal(result.suggestedPriceAed, 0);
  assert.equal(result.estimatedProfitAed, 0);
  assert.equal(result.margin, 0);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "missing_cost",
      message: "缺少商品成本，无法计算利润。",
    },
  ]);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/noon-profit.test.js`

Expected: FAIL with `Cannot find module` for `scripts/lib/noon-profit.js`.

- [ ] **Step 3: Implement the minimal module**

Create `scripts/lib/noon-profit.js`:

```js
export function normalizeProfitConfig(config = {}) {
  return {
    costCny: numberValue(config.costCny),
    shippingCny: numberValue(config.shippingCny),
    exchangeRate: numberValue(config.exchangeRate) || 1.96,
    platformFeeRate: rateValue(config.platformFeeRate),
    targetMargin: rateValue(config.targetMargin) || 0.28,
  };
}

export function calculateNoonProfit(input = {}) {
  const config = normalizeProfitConfig(input);
  const warnings = [];

  if (!config.costCny) {
    warnings.push({ code: "missing_cost", message: "缺少商品成本，无法计算利润。" });
    return emptyResult(warnings);
  }

  if (!config.exchangeRate) {
    warnings.push({ code: "missing_exchange_rate", message: "缺少汇率，无法计算利润。" });
    return emptyResult(warnings);
  }

  const totalCostAed = (config.costCny + config.shippingCny) / config.exchangeRate;
  const denominator = 1 - config.platformFeeRate - config.targetMargin;
  if (denominator <= 0) {
    warnings.push({ code: "invalid_margin_config", message: "平台费率和目标利润率之和必须小于 100%。" });
    return emptyResult(warnings);
  }

  const suggestedPriceAed = roundMoney(totalCostAed / denominator);
  const salePriceAed = numberValue(input.salePriceAed) || suggestedPriceAed;
  const estimatedProfitAed = roundMoney(salePriceAed * (1 - config.platformFeeRate) - totalCostAed);
  const margin = salePriceAed ? roundRate(estimatedProfitAed / salePriceAed) : 0;
  const belowTarget = margin < config.targetMargin;

  if (belowTarget) {
    warnings.push({
      code: "low_margin",
      message: `毛利率 ${formatPercent(margin)} 低于目标利润率 ${formatPercent(config.targetMargin)}。`,
    });
  }

  return {
    suggestedPriceAed,
    estimatedProfitAed,
    margin,
    belowTarget,
    warnings,
  };
}

function emptyResult(warnings) {
  return {
    suggestedPriceAed: 0,
    estimatedProfitAed: 0,
    margin: 0,
    belowTarget: true,
    warnings,
  };
}

function numberValue(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : 0;
}

function rateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const number = numberValue(text.replace(/%$/, ""));
  return text.endsWith("%") || number > 1 ? number / 100 : number;
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function roundRate(value) {
  return Number(value.toFixed(2));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}
```

- [ ] **Step 4: Run the focused tests**

Run: `node --test tests/noon-profit.test.js`

Expected: PASS with 4 tests.

- [ ] **Step 5: Run the full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/noon-profit.js tests/noon-profit.test.js
git commit -m "feat: add noon profit calculation"
```

---

### Task 2: Operation Check Module

**Files:**
- Create: `scripts/lib/noon-operation-checks.js`
- Create: `tests/noon-operation-checks.test.js`

**Interfaces:**
- Consumes:
  - `calculateNoonProfit(input)` from Task 1.
  - Product objects loaded from `meta.json` and `noon-product-attributes.json`.
- Produces:
  - `checkNoonProduct({ productDir, meta, noon, productRoot, allProducts, profitConfig }): OperationCheck`
  - `checkNoonProducts({ productsDir, productDirs, profitConfig }): Promise<{ checked: OperationCheck[], summary: object }>`
  - `normalizeOperationCheck(result): OperationCheck`
- `OperationCheck` shape:

```js
{
  productDir: "1688/default/1001",
  status: "ready" | "blocked" | "warning",
  blockingIssues: [{ code: "missing_barcode", message: "variant 1 缺少 barcode。" }],
  warnings: [{ code: "low_margin", message: "毛利率 12% 低于目标利润率 28%。" }],
  profit: { suggestedPriceAed: 35.45, estimatedProfitAed: 9.93, margin: 0.28, belowTarget: false, warnings: [] },
  variantCount: 1,
  skuCount: 1
}
```

- [ ] **Step 1: Write the failing tests**

Create `tests/noon-operation-checks.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { checkNoonProduct, checkNoonProducts } from "../scripts/lib/noon-operation-checks.js";

test("checkNoonProduct passes a complete product", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [],
    profitConfig: { costCny: 38, shippingCny: 12, exchangeRate: 1.96, platformFeeRate: 0.12, targetMargin: 0.28 },
    imageExists: () => true,
  });

  assert.equal(result.status, "ready");
  assert.deepEqual(result.blockingIssues, []);
  assert.equal(result.variantCount, 1);
  assert.equal(result.skuCount, 1);
  assert.equal(result.profit.suggestedPriceAed, 35.45);
});

test("checkNoonProduct reports missing required variant fields", () => {
  const noon = completeNoon();
  delete noon.variants[0].barcode;
  delete noon.variants[0].actual_weight_kg;

  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon,
    allProducts: [],
    profitConfig: {},
    imageExists: () => true,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["missing_barcode", "missing_actual_weight_kg"]);
});

test("checkNoonProduct reports missing local images", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [],
    profitConfig: {},
    imageExists: () => false,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["missing_image_file"]);
});

test("checkNoonProduct reports duplicate SKU and barcode from allProducts", () => {
  const result = checkNoonProduct({
    productDir: "1688/default/1001",
    productRoot: "/tmp/products/1688/default/1001",
    meta: completeMeta(),
    noon: completeNoon(),
    allProducts: [
      {
        productDir: "1688/default/1002",
        noon: {
          variants: [{ partner_sku: "1688-1001-GOLD", barcode: "10010001" }],
        },
      },
    ],
    profitConfig: {},
    imageExists: () => true,
  });

  assert.equal(result.status, "blocked");
  assert.deepEqual(result.blockingIssues.map((issue) => issue.code), ["duplicate_partner_sku", "duplicate_barcode"]);
});

test("checkNoonProducts reads product directories and summarizes failures", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "operation-checks-"));
  const productDir = path.join(root, "1688", "default", "1001");
  await mkdir(productDir, { recursive: true });
  await writeFile(path.join(productDir, "meta.json"), JSON.stringify(completeMeta()), "utf8");
  await writeFile(path.join(productDir, "noon-product-attributes.json"), JSON.stringify(completeNoon()), "utf8");

  const result = await checkNoonProducts({
    productsDir: root,
    productDirs: ["1688/default/1001", "1688/default/missing"],
    profitConfig: {},
  });

  assert.equal(result.summary.checkedCount, 2);
  assert.equal(result.summary.readyCount, 1);
  assert.equal(result.summary.blockedCount, 1);
  assert.deepEqual(result.checked.map((item) => item.productDir), ["1688/default/1001", "1688/default/missing"]);
});

function completeMeta() {
  return {
    productId: "1001",
    sourceUrl: "https://detail.1688.com/offer/1001.html",
    title: "Gold evening bag",
    price: "38",
    collectedAt: "2026-06-18T00:00:00.000Z",
    images: [{ path: "images/001.jpg" }, { path: "images/002.jpg" }, { path: "images/003.jpg" }],
  };
}

function completeNoon() {
  return {
    product_group: {
      product_group_name_en: "Gold Evening Bag",
      product_group_name_ar: "حقيبة ذهبية",
      category: "Bags",
    },
    variants: [
      {
        partner_sku: "1688-1001-GOLD",
        barcode: "10010001",
        colour: "Gold",
        title_en: "Gold Evening Bag",
        title_ar: "حقيبة ذهبية",
        price_usd: 18,
        stock: 5,
        actual_weight_kg: 0.5,
        length_cm: 17,
        width_cm: 6,
        height_cm: 15,
        images: [{ path: "images/001.jpg" }, { path: "images/002.jpg" }, { path: "images/003.jpg" }],
      },
    ],
  };
}
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/noon-operation-checks.test.js`

Expected: FAIL with `Cannot find module` for `scripts/lib/noon-operation-checks.js`.

- [ ] **Step 3: Implement operation checks**

Create `scripts/lib/noon-operation-checks.js`:

```js
import { existsSync } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { calculateNoonProfit } from "./noon-profit.js";

const requiredMetaFields = ["sourceUrl", "productId", "title", "price", "collectedAt"];
const requiredVariantFields = [
  "partner_sku",
  "barcode",
  "colour",
  "title_en",
  "title_ar",
  "price_usd",
  "stock",
  "actual_weight_kg",
  "length_cm",
  "width_cm",
  "height_cm",
];

export function checkNoonProduct({
  productDir = "",
  productRoot = "",
  meta = null,
  noon = null,
  allProducts = [],
  profitConfig = {},
  imageExists = existsSync,
} = {}) {
  const blockingIssues = [];
  const warnings = [];

  if (!meta) {
    blockingIssues.push(issue("missing_meta", "meta.json 不可读取。"));
  } else {
    for (const field of requiredMetaFields) {
      if (!hasValue(meta[field]) && !(field === "sourceUrl" && hasValue(meta.source?.url))) {
        blockingIssues.push(issue(`missing_${field}`, `meta.json 缺少 ${field}。`));
      }
    }
  }

  if (!noon) {
    blockingIssues.push(issue("missing_noon_attributes", "noon-product-attributes.json 不可读取。"));
    return normalizeOperationCheck({ productDir, blockingIssues, warnings, profit: calculateNoonProfit(profitConfig), variantCount: 0, skuCount: 0 });
  }

  const group = noon.product_group || {};
  if (!hasValue(group.product_group_name_en)) blockingIssues.push(issue("missing_title_en", "缺少英文标题。"));
  if (!hasValue(group.product_group_name_ar)) blockingIssues.push(issue("missing_title_ar", "缺少阿拉伯语标题。"));
  if (!hasValue(group.category) && !hasValue(group.category_code)) blockingIssues.push(issue("missing_category", "缺少类目字段。"));

  const variants = Array.isArray(noon.variants) ? noon.variants : [];
  if (variants.length === 0) blockingIssues.push(issue("missing_variants", "缺少 variants。"));

  const seenSkus = new Map();
  const seenBarcodes = new Map();
  for (const other of allProducts) {
    if (other.productDir === productDir) continue;
    for (const variant of Array.isArray(other.noon?.variants) ? other.noon.variants : []) {
      if (hasValue(variant.partner_sku)) seenSkus.set(String(variant.partner_sku), other.productDir);
      if (hasValue(variant.barcode)) seenBarcodes.set(String(variant.barcode), other.productDir);
    }
  }

  for (const [index, variant] of variants.entries()) {
    const label = `variant ${index + 1}`;
    for (const field of requiredVariantFields) {
      if (!hasValue(variant[field])) blockingIssues.push(issue(`missing_${field}`, `${label} 缺少 ${field}。`));
    }

    if (seenSkus.has(String(variant.partner_sku))) {
      blockingIssues.push(issue("duplicate_partner_sku", `${label} 的 partner_sku 与 ${seenSkus.get(String(variant.partner_sku))} 重复。`));
    }
    if (seenBarcodes.has(String(variant.barcode))) {
      blockingIssues.push(issue("duplicate_barcode", `${label} 的 barcode 与 ${seenBarcodes.get(String(variant.barcode))} 重复。`));
    }

    const images = Array.isArray(variant.images) ? variant.images : [];
    if (images.length < 3) warnings.push(issue("low_image_count", `${label} 少于 3 张图片。`));
    for (const image of images) {
      const imagePath = typeof image === "string" ? image : image?.path;
      if (imagePath && !imageExists(path.join(productRoot, imagePath))) {
        blockingIssues.push(issue("missing_image_file", `${label} 引用的图片不存在: ${imagePath}`));
        break;
      }
    }
  }

  const profit = calculateNoonProfit({
    ...profitConfig,
    costCny: profitConfig.costCny || meta?.price,
    salePriceAed: firstValue(variants.map((variant) => variant.price_usd ?? variant.price)),
  });
  warnings.push(...profit.warnings);

  return normalizeOperationCheck({
    productDir,
    blockingIssues,
    warnings,
    profit,
    variantCount: variants.length,
    skuCount: new Set(variants.map((variant) => variant.partner_sku).filter(hasValue)).size,
  });
}

export async function checkNoonProducts({ productsDir, productDirs = [], profitConfig = {} } = {}) {
  const loaded = [];
  for (const productDir of productDirs) {
    loaded.push(await readProduct(productsDir, productDir));
  }

  const checked = loaded.map((product) =>
    checkNoonProduct({
      ...product,
      allProducts: loaded,
      profitConfig,
    }),
  );

  return {
    checked,
    summary: {
      checkedCount: checked.length,
      readyCount: checked.filter((item) => item.status === "ready").length,
      warningCount: checked.filter((item) => item.status === "warning").length,
      blockedCount: checked.filter((item) => item.status === "blocked").length,
    },
  };
}

export async function writeOperationCheck(productsDir, check) {
  const productRoot = safeProductRoot(productsDir, check.productDir);
  const noonPath = path.join(productRoot, "noon-product-attributes.json");
  const noon = JSON.parse(await readFile(noonPath, "utf8"));
  noon.operation_check = normalizeOperationCheck(check);
  await writeFile(noonPath, `${JSON.stringify(noon, null, 2)}\n`, "utf8");
  return noon.operation_check;
}

export function normalizeOperationCheck(result = {}) {
  const blockingIssues = Array.isArray(result.blockingIssues) ? result.blockingIssues : [];
  const warnings = Array.isArray(result.warnings) ? result.warnings : [];
  return {
    productDir: String(result.productDir || ""),
    status: blockingIssues.length > 0 ? "blocked" : warnings.length > 0 ? "warning" : "ready",
    blockingIssues,
    warnings,
    profit: result.profit || calculateNoonProfit({}),
    variantCount: Number(result.variantCount || 0),
    skuCount: Number(result.skuCount || 0),
    checkedAt: result.checkedAt || new Date().toISOString(),
  };
}

async function readProduct(productsDir, productDir) {
  const productRoot = safeProductRoot(productsDir, productDir);
  return {
    productDir,
    productRoot,
    meta: await readJsonOrNull(path.join(productRoot, "meta.json")),
    noon: await readJsonOrNull(path.join(productRoot, "noon-product-attributes.json")),
  };
}

async function readJsonOrNull(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function safeProductRoot(productsDir, productDir) {
  const fullPath = path.resolve(productsDir, productDir);
  const basePath = `${path.resolve(productsDir)}${path.sep}`;
  if (fullPath !== path.resolve(productsDir) && !fullPath.startsWith(basePath)) {
    throw new Error("Invalid productDir");
  }
  return fullPath;
}

function issue(code, message) {
  return { code, message };
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function firstValue(values) {
  return values.find(hasValue);
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/noon-operation-checks.test.js`

Expected: PASS with 5 tests.

- [ ] **Step 5: Run related tests**

Run: `node --test tests/noon-profit.test.js tests/noon-operation-checks.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/noon-operation-checks.js tests/noon-operation-checks.test.js
git commit -m "feat: add noon operation checks"
```

---

### Task 3: Bulk Operation Writer

**Files:**
- Create: `scripts/lib/noon-bulk-operations.js`
- Create: `tests/noon-bulk-operations.test.js`

**Interfaces:**
- Consumes:
  - `writeOperationCheck(productsDir, check)` from Task 2.
  - Existing `noon-product-attributes.json` structure.
- Produces:
  - `applyBulkOperation({ productsDir, productDirs, operation, operationCheckByProductDir }): Promise<{ operation, changedCount, skippedCount, failedCount, changed, skipped, failed }>`
- Supported operations:
  - `{ type: "set_price", priceUsd: 18.5 }`
  - `{ type: "set_stock", stock: 9 }`
  - `{ type: "deactivate" }`
  - `{ type: "set_processing_time", processingTime: "5_days" }`

- [ ] **Step 1: Write the failing tests**

Create `tests/noon-bulk-operations.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { applyBulkOperation } from "../scripts/lib/noon-bulk-operations.js";

test("applyBulkOperation sets price on every variant", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_price", priceUsd: 18.5 },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 1);
  assert.equal(noon.variants[0].price_usd, 18.5);
  assert.equal(noon.operation_status, "active");
});

test("applyBulkOperation sets stock on every variant", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({ productsDir, productDirs: [productDir], operation: { type: "set_stock", stock: 9 } });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.variants[0].stock, 9);
});

test("applyBulkOperation deactivates product and sets stock to zero", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({ productsDir, productDirs: [productDir], operation: { type: "deactivate" } });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.operation_status, "inactive");
  assert.equal(noon.variants[0].stock, 0);
});

test("applyBulkOperation stores processing time locally only", async () => {
  const { productsDir, productDir } = await createProduct();
  await applyBulkOperation({ productsDir, productDirs: [productDir], operation: { type: "set_processing_time", processingTime: "5_days" } });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(noon.operation.processing_time, "5_days");
  assert.equal(noon.variants[0].processing_time, "2_days");
});

test("applyBulkOperation skips blocked products", async () => {
  const { productsDir, productDir } = await createProduct();
  const result = await applyBulkOperation({
    productsDir,
    productDirs: [productDir],
    operation: { type: "set_price", priceUsd: 18.5 },
    operationCheckByProductDir: {
      [productDir]: { status: "blocked", blockingIssues: [{ code: "missing_barcode", message: "variant 1 缺少 barcode。" }] },
    },
  });

  const noon = await readNoon(productsDir, productDir);
  assert.equal(result.changedCount, 0);
  assert.equal(result.skippedCount, 1);
  assert.equal(noon.variants[0].price_usd, 10);
});

async function createProduct() {
  const root = await mkdtemp(path.join(os.tmpdir(), "bulk-operations-"));
  const productsDir = path.join(root, "products");
  const productDir = "1688/default/1001";
  const fullProductDir = path.join(productsDir, productDir);
  await mkdir(fullProductDir, { recursive: true });
  await writeFile(
    path.join(fullProductDir, "noon-product-attributes.json"),
    JSON.stringify({
      product_group: { product_group_name_en: "Gold Bag" },
      operation_status: "active",
      variants: [{ partner_sku: "1688-1001-GOLD", barcode: "10010001", price_usd: 10, stock: 3, processing_time: "2_days" }],
    }),
    "utf8",
  );
  return { productsDir, productDir };
}

async function readNoon(productsDir, productDir) {
  return JSON.parse(await readFile(path.join(productsDir, productDir, "noon-product-attributes.json"), "utf8"));
}
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/noon-bulk-operations.test.js`

Expected: FAIL with `Cannot find module` for `scripts/lib/noon-bulk-operations.js`.

- [ ] **Step 3: Implement bulk operations**

Create `scripts/lib/noon-bulk-operations.js`:

```js
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export async function applyBulkOperation({ productsDir, productDirs = [], operation = {}, operationCheckByProductDir = {} } = {}) {
  const result = {
    operation: operation.type || "",
    changedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    changed: [],
    skipped: [],
    failed: [],
  };

  for (const productDir of productDirs) {
    const check = operationCheckByProductDir[productDir];
    if (check?.status === "blocked" || check?.blockingIssues?.length) {
      result.skippedCount += 1;
      result.skipped.push({ productDir, reason: "blocked", blockingIssues: check.blockingIssues || [] });
      continue;
    }

    try {
      const filePath = path.join(safeProductRoot(productsDir, productDir), "noon-product-attributes.json");
      const noon = JSON.parse(await readFile(filePath, "utf8"));
      const next = applyOperationToNoon(noon, operation);
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      result.changedCount += 1;
      result.changed.push({ productDir });
    } catch (error) {
      result.failedCount += 1;
      result.failed.push({ productDir, error: error.message });
    }
  }

  return result;
}

export function applyOperationToNoon(noon, operation = {}) {
  const next = structuredClone(noon || {});
  const variants = Array.isArray(next.variants) ? next.variants : [];
  next.operation_status = next.operation_status || "active";
  next.operation = next.operation || {};
  next.operation.updatedAt = new Date().toISOString();

  if (operation.type === "set_price") {
    const price = numberValue(operation.priceUsd);
    if (!price) throw new Error("priceUsd must be greater than 0");
    for (const variant of variants) variant.price_usd = price;
    next.operation.last_bulk_operation = "set_price";
    return next;
  }

  if (operation.type === "set_stock") {
    const stock = integerValue(operation.stock);
    if (stock < 0) throw new Error("stock must be 0 or greater");
    for (const variant of variants) variant.stock = stock;
    next.operation.last_bulk_operation = "set_stock";
    return next;
  }

  if (operation.type === "deactivate") {
    next.operation_status = "inactive";
    for (const variant of variants) variant.stock = 0;
    next.operation.last_bulk_operation = "deactivate";
    return next;
  }

  if (operation.type === "set_processing_time") {
    const processingTime = String(operation.processingTime || "").trim();
    if (!processingTime) throw new Error("processingTime is required");
    next.operation.processing_time = processingTime;
    next.operation.last_bulk_operation = "set_processing_time";
    return next;
  }

  throw new Error(`Unsupported bulk operation: ${operation.type || ""}`);
}

function safeProductRoot(productsDir, productDir) {
  const fullPath = path.resolve(productsDir, productDir);
  const basePath = `${path.resolve(productsDir)}${path.sep}`;
  if (fullPath !== path.resolve(productsDir) && !fullPath.startsWith(basePath)) {
    throw new Error("Invalid productDir");
  }
  return fullPath;
}

function numberValue(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}

function integerValue(value) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(number) ? number : -1;
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/noon-bulk-operations.test.js`

Expected: PASS with 5 tests.

- [ ] **Step 5: Run related tests**

Run: `node --test tests/noon-bulk-operations.test.js tests/noon-operation-checks.test.js`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/noon-bulk-operations.js tests/noon-bulk-operations.test.js
git commit -m "feat: add noon bulk operation writer"
```

---

### Task 4: Store-Scoped Upload Status

**Files:**
- Modify: `scripts/lib/noon-upload-status.js`
- Modify: `tests/noon-upload-status.test.js`

**Interfaces:**
- Consumes: existing `noon-upload-status.json` files.
- Produces:
  - `normalizeStoreId(storeId: string): string`
  - `readStoreNoonUploadStatusFromProductDir(productDir: string, relativeDir: string, storeId: string): object`
  - `writeStoreNoonUploadStatus(productDir: string, status: object, storeId: string): Promise<object>`
- Backward compatibility:
  - `readNoonUploadStatusFromProductDir(productDir, relativeDir)` still returns the old top-level status.
  - Old status files without `stores` still read correctly.

- [ ] **Step 1: Add failing tests to `tests/noon-upload-status.test.js`**

Extend the existing import from `../scripts/lib/noon-upload-status.js` so it includes the three new exports:

```js
import {
  defaultNoonUploadStatus,
  noonUploadStatusFileName,
  readNoonUploadStatusFromProductDir,
  normalizeStoreId,
  readStoreNoonUploadStatusFromProductDir,
  writeNoonUploadStatus,
  writeStoreNoonUploadStatus,
} from "../scripts/lib/noon-upload-status.js";
```

Then append these tests:

```js
test("store scoped upload status records separate stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-store-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });

  await writeStoreNoonUploadStatus(
    productDir,
    {
      productDir: "1688/repo/1001",
      status: "uploaded",
      uploaded: true,
      uploadedAt: "2026-06-18T00:00:00.000Z",
      partnerSku: "SBS-CLUTCH-002",
      message: "UAE 店铺上传成功。",
    },
    "noon-uae-main",
  );

  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "noon-uae-main").uploaded, true);
  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "noon-sa-second").uploaded, false);
});

test("normalizeStoreId keeps safe manual store IDs", () => {
  assert.equal(normalizeStoreId("noon-uae-main"), "noon-uae-main");
  assert.equal(normalizeStoreId(" Noon UAE Main "), "noon-uae-main");
  assert.throws(() => normalizeStoreId("../bad"), /Invalid store ID/);
});
```

- [ ] **Step 2: Run the tests to verify failure**

Run: `node --test tests/noon-upload-status.test.js`

Expected: FAIL because the new exports do not exist.

- [ ] **Step 3: Extend `scripts/lib/noon-upload-status.js`**

Replace the file with:

```js
import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const noonUploadStatusFileName = "noon-upload-status.json";

export function defaultNoonUploadStatus(productDir = "") {
  return {
    productDir,
    status: "not_uploaded",
    uploaded: false,
    uploadedAt: "",
    partnerSku: "",
    message: "尚未上传到 noon。",
  };
}

export function normalizeStoreId(storeId = "") {
  const normalized = String(storeId || "default").trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized || normalized.includes("..") || normalized.includes("/")) throw new Error("Invalid store ID");
  return normalized;
}

export function readNoonUploadStatusFromProductDir(productDir, relativeDir = "") {
  const raw = readRawStatus(productDir);
  if (!raw) return defaultNoonUploadStatus(relativeDir);
  if (raw.status_unreadable) return unreadableStatus(relativeDir);
  return normalizeNoonUploadStatus(raw, relativeDir);
}

export function readStoreNoonUploadStatusFromProductDir(productDir, relativeDir = "", storeId = "default") {
  const raw = readRawStatus(productDir);
  if (!raw) return defaultNoonUploadStatus(relativeDir);
  if (raw.status_unreadable) return unreadableStatus(relativeDir);
  const id = normalizeStoreId(storeId);
  return normalizeNoonUploadStatus(raw.stores?.[id] || {}, relativeDir);
}

export async function writeNoonUploadStatus(productDir, status) {
  const next = normalizeNoonUploadStatus(status, status.productDir || "");
  await writeFile(path.join(productDir, noonUploadStatusFileName), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function writeStoreNoonUploadStatus(productDir, status, storeId = "default") {
  const raw = readRawStatus(productDir);
  const base = raw && !raw.status_unreadable ? raw : {};
  const id = normalizeStoreId(storeId);
  const next = {
    ...base,
    stores: {
      ...(base.stores || {}),
      [id]: normalizeNoonUploadStatus(status, status.productDir || ""),
    },
  };
  await writeFile(path.join(productDir, noonUploadStatusFileName), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next.stores[id];
}

function readRawStatus(productDir) {
  const statusPath = path.join(productDir, noonUploadStatusFileName);
  if (!existsSync(statusPath)) return null;
  try {
    return JSON.parse(readFileSync(statusPath, "utf8"));
  } catch {
    return { status_unreadable: true };
  }
}

function unreadableStatus(relativeDir) {
  return {
    ...defaultNoonUploadStatus(relativeDir),
    status: "status_unreadable",
    message: "noon 上传状态文件不可读取。",
  };
}

function normalizeNoonUploadStatus(status, relativeDir) {
  const uploaded = Boolean(status.uploaded) || status.status === "uploaded";
  return {
    productDir: String(status.productDir || relativeDir || ""),
    status: uploaded ? "uploaded" : String(status.status || "not_uploaded"),
    uploaded,
    uploadedAt: String(status.uploadedAt || ""),
    partnerSku: String(status.partnerSku || status.noonSku || ""),
    message: String(status.message || (uploaded ? "已上传到 noon。" : "尚未上传到 noon。")),
  };
}
```

- [ ] **Step 4: Run focused tests**

Run: `node --test tests/noon-upload-status.test.js`

Expected: PASS.

- [ ] **Step 5: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add scripts/lib/noon-upload-status.js tests/noon-upload-status.test.js
git commit -m "feat: scope noon upload status by store"
```

---

### Task 5: Export Gate and Inactive Rows

**Files:**
- Modify: `scripts/lib/noon-bulk-update-exporter.js`
- Modify: `tests/noon-bulk-update-exporter.test.js`

**Interfaces:**
- Consumes:
  - `noon.operation_check.blockingIssues`
  - `noon.operation_status`
- Produces:
  - `exportNoonBulkUpdates(...)` return object adds `skippedProducts`.
  - `priceRows` emits `is_active = "FALSE"` for inactive products.
  - `stockRows` emits `stock_gross = 0` for inactive products.

- [ ] **Step 1: Add failing tests**

Append to `tests/noon-bulk-update-exporter.test.js`:

```js
test("exportNoonBulkUpdates skips products with blocking operation checks", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-blocking-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.operation_check = { status: "blocked", blockingIssues: [{ code: "missing_barcode", message: "variant 1 缺少 barcode。" }] };
  await writeFile(filePath, JSON.stringify(product), "utf8");

  const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.equal(result.skuCount, 0);
  assert.deepEqual(result.skippedProducts, [{ source: "default/1001", reason: "blocking_operation_check" }]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)), [["partner_sku", "country_code", "price_usd", "is_active"]]);
});

test("exportNoonBulkUpdates emits inactive price and zero stock rows", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "noon-bulk-inactive-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1688", "default", "1001");
  const outputDir = path.join(tempDir, "exports");
  await mkdir(productDir, { recursive: true });
  await writeNoonProduct(productDir, { sku: "1688-1001-GOLD", barcode: "10010001", title: "Gold Bag" });
  const filePath = path.join(productDir, "noon-product-attributes.json");
  const product = JSON.parse(await readFile(filePath, "utf8"));
  product.operation_status = "inactive";
  await writeFile(filePath, JSON.stringify(product), "utf8");

  await exportNoonBulkUpdates({ productsDir, outputDir, platform: "1688" });

  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.price)).slice(1), [["G-1001-1001-GOLD", "sa", 10, "FALSE"]]);
  assert.deepEqual(readRows(path.join(outputDir, bulkUpdateFileNames.stock)).slice(1), [
    ["sa", "517205", "G-1001-1001-GOLD", "W00183886CN", 0, "2_days", 0, "2_days"],
  ]);
});
```

- [ ] **Step 2: Run exporter tests to verify failure**

Run: `node --test tests/noon-bulk-update-exporter.test.js`

Expected: FAIL because `skippedProducts` is missing and inactive rows still export active stock.

- [ ] **Step 3: Modify exporter product filtering**

In `scripts/lib/noon-bulk-update-exporter.js`, update `exportNoonBulkUpdates`:

```js
export async function exportNoonBulkUpdates({ productsDir, outputDir, platform = "", repository = "", catalogType = "global" }) {
  const products = await readNoonProducts(productsDir, { platform, repository });
  const skippedProducts = products
    .filter((product) => hasBlockingOperationCheck(product.noonAttributes))
    .map((product) => ({ source: product.relativeDir, reason: "blocking_operation_check" }));
  const exportableProducts = products.filter((product) => !hasBlockingOperationCheck(product.noonAttributes));
  const { products: uniqueProducts, duplicateProducts } = dedupeProducts(exportableProducts);
  const allRows = uniqueProducts.flatMap((product) => toSkuRows(product, { platform, catalogType })).filter((row) => row.partnerSku);
  const { rows, duplicateSkus } = dedupeSkuRows(allRows);

  await mkdir(outputDir, { recursive: true });

  const files = {
    product: path.join(outputDir, bulkUpdateFileNames.product),
    price: path.join(outputDir, bulkUpdateFileNames.price),
    stock: path.join(outputDir, bulkUpdateFileNames.stock),
  };

  writeWorkbook(files.product, "Global Product Update", productRows(rows));
  writeWorkbook(files.price, "Global Price Update", priceRows(rows));
  writeWorkbook(files.stock, "Stock Import", stockRows(rows));

  return {
    skuCount: rows.length,
    productCount: uniqueProducts.length,
    duplicateProducts,
    duplicateSkus,
    skippedProducts,
    files,
  };
}
```

Add helper:

```js
function hasBlockingOperationCheck(noonAttributes) {
  return (noonAttributes.operation_check?.blockingIssues || []).length > 0;
}
```

- [ ] **Step 4: Include operation status in SKU rows**

In `toSkuRows`, add `operationStatus`:

```js
function toSkuRows(product, { platform = "", catalogType = "global" } = {}) {
  const group = product.noonAttributes.product_group ?? {};
  const uploadConfig = product.noonAttributes.upload_config ?? {};
  const variants = Array.isArray(product.noonAttributes.variants) ? product.noonAttributes.variants : [];
  const operationStatus = cleanText(product.noonAttributes.operation_status) || "active";

  return variants.map((variant) => ({
    source: product.relativeDir,
    partnerSku: catalogPartnerSku(variant.partner_sku, { platform, catalogType }),
    barcode: cleanText(variant.barcode),
    colour: cleanText(variant.colour || variant.colour_name),
    titleEn: cleanText(variant.title_en),
    titleAr: cleanText(variant.title_ar),
    images: normalizeImages(variant.images),
    countryCode: cleanText(uploadConfig.country_code) || "sa",
    idPartner: cleanText(uploadConfig.id_partner) || "517205",
    hsCode: cleanText(group.hs_code),
    countryOfOrigin: countryCode(group.country_of_origin),
    vmWeightCm: blankNull(variant.vm_weight_cm ?? volumetricWeight(variant)),
    weightKg: blankNull(variant.actual_weight_kg),
    lengthCm: blankNull(variant.length_cm),
    widthCm: blankNull(variant.width_cm),
    heightCm: blankNull(variant.height_cm),
    priceUsd: blankNull(variant.price_usd),
    stock: operationStatus === "inactive" ? 0 : blankNull(variant.stock),
    processingTime: cleanText(variant.processing_time) || "2_days",
    warehouseCode: cleanText(variant.warehouse_code || uploadConfig.warehouse_code) || "W00183886CN",
    operationStatus,
  }));
}
```

Update `priceRows`:

```js
function priceRows(rows) {
  return [
    ["partner_sku", "country_code", "price_usd", "is_active"],
    ...rows.map((row) => [row.partnerSku, row.countryCode, row.priceUsd, row.operationStatus === "inactive" ? "FALSE" : "TRUE"]),
  ];
}
```

- [ ] **Step 5: Run exporter tests**

Run: `node --test tests/noon-bulk-update-exporter.test.js`

Expected: PASS.

- [ ] **Step 6: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add scripts/lib/noon-bulk-update-exporter.js tests/noon-bulk-update-exporter.test.js
git commit -m "feat: gate noon bulk exports"
```

---

### Task 6: Server APIs for Checks and Operations

**Files:**
- Modify: `scripts/server.js`
- Test through existing module tests and manual API calls.

**Interfaces:**
- Consumes:
  - `checkNoonProducts`, `writeOperationCheck` from Task 2.
  - `applyBulkOperation` from Task 3.
  - `readStoreNoonUploadStatusFromProductDir` from Task 4.
- Produces:
  - `POST /api/operation-checks`
  - `POST /api/bulk-operations`
  - Product summaries include `operationStatus`, `operationCheck`, and selected store upload status.

- [ ] **Step 1: Add imports**

At the top of `scripts/server.js`, update imports:

```js
import { applyBulkOperation } from "./lib/noon-bulk-operations.js";
import { checkNoonProducts, writeOperationCheck } from "./lib/noon-operation-checks.js";
import {
  readNoonUploadStatusFromProductDir,
  readStoreNoonUploadStatusFromProductDir,
} from "./lib/noon-upload-status.js";
```

Remove the old single-line import of `readNoonUploadStatusFromProductDir`.

- [ ] **Step 2: Add settings keys**

Add these keys to `uiSettingKeys`:

```js
"storesJson",
"defaultStoreId",
"globalExchangeRate",
"globalPlatformFeeRate",
"globalTargetMargin",
```

- [ ] **Step 3: Add routes**

Inside the server route block, after `/api/noon-bulk-updates`, add:

```js
    if (request.method === "POST" && url.pathname === "/api/operation-checks") {
      await createOperationChecks(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bulk-operations") {
      await createBulkOperation(request, response);
      return;
    }
```

- [ ] **Step 4: Add API handlers**

Add below `createNoonBulkUpdateFiles`:

```js
async function createOperationChecks(request, response) {
  const body = await readJsonBody(request);
  const productDirs = sanitizeProductDirs(body.productDirs);
  if (productDirs.length === 0) throw new Error("请选择要检查的商品。");

  const result = await checkNoonProducts({
    productsDir,
    productDirs,
    profitConfig: profitConfigFromBody(body),
  });

  for (const check of result.checked) {
    if (check.status !== "blocked" || check.blockingIssues.some((issue) => issue.code !== "missing_noon_attributes")) {
      try {
        await writeOperationCheck(productsDir, check);
      } catch {
        // Missing or unreadable noon attributes are already represented in the check result.
      }
    }
  }

  sendJson(response, result);
}

async function createBulkOperation(request, response) {
  const body = await readJsonBody(request);
  const productDirs = sanitizeProductDirs(body.productDirs);
  if (productDirs.length === 0) throw new Error("请选择要操作的商品。");

  const checks = await checkNoonProducts({
    productsDir,
    productDirs,
    profitConfig: profitConfigFromBody(body),
  });
  const operationCheckByProductDir = Object.fromEntries(checks.checked.map((check) => [check.productDir, check]));
  const operationResult = await applyBulkOperation({
    productsDir,
    productDirs,
    operation: sanitizeBulkOperation(body.operation),
    operationCheckByProductDir,
  });

  const repository = String(body.repository || "");
  const catalogType = String(body.catalogType || "global");
  const exportResult = await exportNoonBulkUpdates({
    productsDir,
    outputDir: globalBulkUpdateOutputDir(repository || "all"),
    platform: "1688",
    repository: repository === "__default__" ? "default" : repository,
    catalogType,
  });

  sendJson(response, {
    checks,
    operation: operationResult,
    export: exportResult,
    files: bulkUpdateFileUrls(repository || "all"),
  });
}
```

- [ ] **Step 5: Add sanitizers**

Add near existing helper functions:

```js
function sanitizeProductDirs(productDirs) {
  return (Array.isArray(productDirs) ? productDirs : [])
    .map((dir) => cleanPathSegment(dir))
    .filter(Boolean);
}

function sanitizeBulkOperation(operation = {}) {
  const type = String(operation.type || "");
  if (type === "set_price") return { type, priceUsd: operation.priceUsd };
  if (type === "set_stock") return { type, stock: operation.stock };
  if (type === "deactivate") return { type };
  if (type === "set_processing_time") return { type, processingTime: operation.processingTime };
  throw new Error("不支持的批量操作。");
}

function profitConfigFromBody(body = {}) {
  return {
    costCny: body.costCny,
    shippingCny: body.shippingCny,
    exchangeRate: body.exchangeRate,
    platformFeeRate: body.platformFeeRate,
    targetMargin: body.targetMargin,
  };
}
```

- [ ] **Step 6: Extend product summaries**

In `readNoonProductSummary`, include:

```js
        operationStatus: product.operation_status || "active",
        operationCheck: product.operation_check || null,
```

In `readProductSummary`, read a `storeId` argument:

```js
async function readProductSummary(relativeDir, repository, storeId = "") {
```

Change the returned status fields:

```js
      noonUploadStatus: storeId ? readNoonUploadStatus(relativeDir, storeId) : readNoonUploadStatus(relativeDir),
```

Change `readNoonUploadStatus`:

```js
function readNoonUploadStatus(productDir, storeId = "") {
  const relativeDir = cleanPathSegment(productDir || "");
  try {
    const fullProductDir = path.dirname(safeProductFilePath(relativeDir, "meta.json"));
    return storeId
      ? readStoreNoonUploadStatusFromProductDir(fullProductDir, relativeDir, storeId)
      : readNoonUploadStatusFromProductDir(fullProductDir, relativeDir);
  } catch {
    return storeId
      ? readStoreNoonUploadStatusFromProductDir(path.join(productsDir, "__missing__"), relativeDir, storeId)
      : readNoonUploadStatusFromProductDir(path.join(productsDir, "__missing__"), relativeDir);
  }
}
```

- [ ] **Step 7: Manual API verification**

Run: `npm run ui`

In another terminal, run:

```bash
curl -sS -X POST http://localhost:4173/api/operation-checks \
  -H 'content-type: application/json' \
  --data '{"productDirs":["1688/default/1001"],"exchangeRate":"1.96","platformFeeRate":"12%","targetMargin":"28%"}'
```

Expected: JSON response with `checked` array. If local fixture product does not exist, expected JSON has a blocked check for that product.

- [ ] **Step 8: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add scripts/server.js
git commit -m "feat: add bulk operation APIs"
```

---

### Task 7: Repository Page Bulk Operation UI

**Files:**
- Modify: `public/index.html`

**Interfaces:**
- Consumes:
  - `POST /api/operation-checks`
  - `POST /api/bulk-operations`
  - Existing `GET /api/products`
- Produces:
  - Repository dialog controls for check, price, stock, deactivate, and processing time operations.
  - Log messages in `repositoryLogEl`.
  - Download links from bulk operation export response.

- [ ] **Step 1: Add UI controls in repository dialog**

Inside `openRepositoryDialog(repository)`, replace the `controls.innerHTML` block with:

```js
          controls.innerHTML = `
            <div class="repository-control-row">
              <label><input type="checkbox" data-select-page />选择本页</label>
              <label>
                店铺
                <input name="operationStoreId" data-operation-store-id placeholder="default" />
              </label>
              <div class="actions" style="margin-top: 0">
                <button class="secondary" type="button" data-check-selected disabled>运行检查</button>
                <button class="secondary" type="button" data-upload-selected disabled>上传选中</button>
                <button type="button" data-upload-repository>上传全部</button>
              </div>
            </div>
            <div class="repository-control-row">
              <label>
                价格 USD
                <input name="bulkPriceUsd" data-bulk-price-usd inputmode="decimal" placeholder="18.5" />
              </label>
              <label>
                库存
                <input name="bulkStock" data-bulk-stock inputmode="numeric" placeholder="9" />
              </label>
              <label>
                时效
                <input name="bulkProcessingTime" data-bulk-processing-time placeholder="5_days" />
              </label>
              <div class="actions" style="margin-top: 0">
                <button class="secondary" type="button" data-set-price disabled>批量改价</button>
                <button class="secondary" type="button" data-set-stock disabled>批量改库存</button>
                <button class="secondary" type="button" data-set-processing-time disabled>批量改时效</button>
                <button class="danger" type="button" data-deactivate-selected disabled>批量停售</button>
              </div>
            </div>
            <div class="repository-control-row">
              <span class="meta" data-selection-summary></span>
            </div>
          `;
```

- [ ] **Step 2: Update control enablement**

Inside `updateControls()`, replace button disabled updates with:

```js
              const hasSelection = selectedProductDirs.size > 0;
              controls.querySelector("[data-upload-selected]").disabled = !hasSelection;
              controls.querySelector("[data-check-selected]").disabled = !hasSelection;
              controls.querySelector("[data-set-price]").disabled = !hasSelection;
              controls.querySelector("[data-set-stock]").disabled = !hasSelection;
              controls.querySelector("[data-set-processing-time]").disabled = !hasSelection;
              controls.querySelector("[data-deactivate-selected]").disabled = !hasSelection;
              controls.querySelector("[data-selection-summary]").textContent =
                `共 ${repository.products.length} 个商品 · 已选 ${selectedProductDirs.size} 个 · 本页 ${pageProducts.length} 个`;
```

- [ ] **Step 3: Add selected dir helper**

Inside `openRepositoryDialog(repository)`, before button event listeners:

```js
          const selectedDirs = () =>
            repository.products.map((product) => product.dirName).filter((dirName) => selectedProductDirs.has(dirName));
```

- [ ] **Step 4: Add operation button handlers**

Add after existing upload handlers:

```js
          controls.querySelector("[data-check-selected]").addEventListener("click", async () => {
            await runOperationChecks(selectedDirs());
          });
          controls.querySelector("[data-set-price]").addEventListener("click", async () => {
            const priceUsd = controls.querySelector("[data-bulk-price-usd]").value.trim();
            await runBulkOperation(repository, selectedDirs(), { type: "set_price", priceUsd });
          });
          controls.querySelector("[data-set-stock]").addEventListener("click", async () => {
            const stock = controls.querySelector("[data-bulk-stock]").value.trim();
            await runBulkOperation(repository, selectedDirs(), { type: "set_stock", stock });
          });
          controls.querySelector("[data-set-processing-time]").addEventListener("click", async () => {
            const processingTime = controls.querySelector("[data-bulk-processing-time]").value.trim();
            await runBulkOperation(repository, selectedDirs(), { type: "set_processing_time", processingTime });
          });
          controls.querySelector("[data-deactivate-selected]").addEventListener("click", async () => {
            await runBulkOperation(repository, selectedDirs(), { type: "deactivate" });
          });
```

- [ ] **Step 5: Add client API functions**

Add near `createBulkUpdateFiles`:

```js
      async function runOperationChecks(productDirs) {
        if (window.location.protocol === "file:" || productDirs.length === 0) return;
        activeJobArea = "repository";
        activeLogEl = repositoryLogEl;
        repositoryLogEl.innerHTML = "";
        appendLog(`开始检查 ${productDirs.length} 个商品...`);

        try {
          const result = await postJson("/api/operation-checks", {
            productDirs,
            ...profitConfigFromForm(),
          });
          appendLog(`检查完成：${result.summary.readyCount} 个可操作，${result.summary.warningCount} 个有警告，${result.summary.blockedCount} 个阻塞。`);
          for (const item of result.checked.filter((check) => check.blockingIssues.length > 0).slice(0, 8)) {
            appendLog(`${item.productDir}: ${item.blockingIssues.map((issue) => issue.message).join(" / ")}`);
          }
          await refreshProducts();
        } catch (error) {
          appendLog(error.message);
        }
      }

      async function runBulkOperation(repository, productDirs, operation) {
        if (window.location.protocol === "file:" || productDirs.length === 0) return;
        activeJobArea = "repository";
        activeLogEl = repositoryLogEl;
        repositoryLogEl.innerHTML = "";
        appendLog(`开始执行 ${operation.type}: ${productDirs.length} 个商品...`);

        try {
          const result = await postJson("/api/bulk-operations", {
            productDirs,
            repository: repository.id === "__default__" ? "default" : repository.id,
            catalogType: "global",
            operation,
            ...profitConfigFromForm(),
          });
          appendLog(`操作完成：${result.operation.changedCount} 个已更新，${result.operation.skippedCount} 个跳过，${result.operation.failedCount} 个失败。`);
          appendLog(`已生成 ${result.export.productCount} 个商品、${result.export.skuCount} 个 SKU 的批量更新表。`);
          if (result.files) {
            appendLog(`下载：${result.files.price} / ${result.files.stock}`);
          }
          await refreshProducts();
        } catch (error) {
          appendLog(error.message);
        }
      }

      function profitConfigFromForm() {
        const data = Object.fromEntries(new FormData(form).entries());
        return {
          exchangeRate: data.globalExchangeRate || "1.96",
          platformFeeRate: data.globalPlatformFeeRate || "12%",
          targetMargin: data.globalTargetMargin || "28%",
        };
      }
```

- [ ] **Step 6: Add settings inputs**

In the settings page section near noon settings, add fields:

```html
              <label>
                默认汇率
                <input name="globalExchangeRate" placeholder="1.96" />
              </label>
              <label>
                默认平台费率
                <input name="globalPlatformFeeRate" placeholder="12%" />
              </label>
              <label>
                默认目标利润率
                <input name="globalTargetMargin" placeholder="28%" />
              </label>
              <label>
                默认店铺 ID
                <input name="defaultStoreId" placeholder="default" />
              </label>
```

- [ ] **Step 7: Manual UI verification**

Run: `npm run ui`

Open: `http://localhost:4173`

Expected:
- 商品仓库页 opens.
- Repository dialog shows bulk operation controls.
- Selecting products enables check and operation buttons.
- Running checks writes log lines with ready/warning/blocked counts.
- Bulk stock update writes log lines and returns export links.

- [ ] **Step 8: Run full suite**

Run: `npm test`

Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add public/index.html
git commit -m "feat: add bulk operation controls"
```

---

## Final Verification

- [ ] Run all tests:

```bash
npm test
```

Expected: PASS.

- [ ] Start the UI:

```bash
npm run ui
```

Expected: server prints `Noon tools UI: http://localhost:4173`.

- [ ] Open `http://localhost:4173`, run a repository check, apply one stock update to selected products, and verify the generated stock xlsx link opens.

- [ ] Inspect git status:

```bash
git status --short
```

Expected: only intentional files changed or a clean tree after commits.

## Self-Review Notes

- Spec coverage:
  - 商品筛选和多选: Task 7.
  - 合规检查和利润计算: Tasks 1 and 2.
  - blocking 阻止上传和导出: Tasks 2, 3, 5, and 6.
  - 批量改价、库存、停售、时效本地字段: Task 3 and Task 7.
  - 多店铺上传状态基础: Task 4 and Task 6.
  - 本地 JSON 和 xlsx 约束: Tasks 3 and 5.
- Placeholder scan: no unresolved placeholders are intended in this plan.
- Type consistency:
  - `productDirs` is always `Array<string>`.
  - `operation.type` values are `set_price`, `set_stock`, `deactivate`, `set_processing_time`.
  - `operation_check` and `operation_status` names are used consistently in modules, server, exporter, and UI.
