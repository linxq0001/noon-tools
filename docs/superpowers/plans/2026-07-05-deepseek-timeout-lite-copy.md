# DeepSeek Timeout Lite Copy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make DeepSeek copy beautification bounded, faster, and safe to fall back to rule-generated noon product copy.

**Architecture:** Move text-only DeepSeek beautification into a focused helper module that can be tested with mocked `fetch`. `scripts/collect-1688.js` keeps generating the full rule-based product, then calls the helper only when `--deepseek true`.

**Tech Stack:** Node.js ESM, built-in `fetch`, `AbortController`, `node:test`, `node:assert/strict`.

## Global Constraints

- Default DeepSeek copy timeout is 20 seconds.
- No new runtime dependency.
- Do not change image vision behavior or `DEEPSEEK_ENABLE_IMAGE_VISION`.
- Do not add UI controls for timeout or AI mode.
- Do not log API keys or full request payloads.
- DeepSeek failure, timeout, or invalid JSON must not block writing `noon-product-attributes.json`.
- Keep feature bullets rule-generated unless DeepSeek returns safe replacements quickly in the existing schema.
- Keep changes scoped to DeepSeek copy beautification and its tests.

---

## File Structure

- Create `scripts/lib/deepseek-copy-beautifier.js`: owns text-only DeepSeek request construction, timeout, response parsing, safe patch application, and `ai_generation` metadata.
- Create `tests/deepseek-copy-beautifier.test.js`: mocked success, timeout, malformed JSON, and field-scope tests.
- Modify `scripts/collect-1688.js`: import `applyDeepSeekBeautification` from the new helper and delete the old local DeepSeek copy helper functions after the import works.

---

### Task 1: Add Tested DeepSeek Copy Helper

**Files:**
- Create: `scripts/lib/deepseek-copy-beautifier.js`
- Create: `tests/deepseek-copy-beautifier.test.js`

**Interfaces:**
- Produces: `applyDeepSeekBeautification(noonProduct: object, meta: object, options?: object): Promise<object>`
- Produces: `buildDeepSeekBeautifyInput(noonProduct: object, meta: object): object`
- Produces: `applyAiCopyPatch(noonProduct: object, patch: object): object`
- Consumes: `globalThis.fetch`, `process.env.DEEPSEEK_API_KEY`, `process.env.DEEPSEEK_MODEL`, `process.env.DEEPSEEK_BASE_URL`

- [ ] **Step 1: Write the failing tests**

Create `tests/deepseek-copy-beautifier.test.js`:

```js
import assert from "node:assert/strict";
import test from "node:test";
import {
  applyAiCopyPatch,
  applyDeepSeekBeautification,
  buildDeepSeekBeautifyInput,
} from "../scripts/lib/deepseek-copy-beautifier.js";

function productFixture() {
  return {
    product_group: {
      product_group_name_en: "Rule Evening Bag",
      product_group_name_ar: "حقيبة سهرة",
      model_name: "Rule Evening Bag",
      category: "Bags & Luggage > Handbag > Clutch",
      brand: "No Brand",
    },
    variants: [
      {
        partner_sku: "G-1001-1001-V01-GOLD",
        barcode: "202604280001",
        colour: "Gold",
        colour_name: "Gold",
        title_en: "Rule Gold Evening Bag",
        title_ar: "حقيبة ذهبية",
        subtitle_en: "Rule subtitle",
        subtitle_ar: "عنوان فرعي",
        description_en: "Rule description stays available.",
        description_ar: "وصف عربي",
        feature_bullets_en: ["Rule bullet"],
        feature_bullets_ar: ["نقطة"],
        price_sar_initial: 99,
      },
    ],
  };
}

function metaFixture() {
  return {
    source: { productId: "1001" },
    sourceTitle: "水钻晚宴包",
    title: "水钻 晚宴包",
    titleParts: ["晚宴包"],
    productTypeText: "晚宴包",
    attributes: [{ name: "材质", value: "PU" }],
    packageInfo: { weightG: 500 },
    dimensions: { lengthCm: 20, widthCm: 5, heightCm: 12 },
  };
}

test("buildDeepSeekBeautifyInput keeps the AI task lightweight", () => {
  const input = buildDeepSeekBeautifyInput(productFixture(), metaFixture());

  assert.deepEqual(input.output_schema.variants[0], {
    index: "number",
    title_en: "string",
    title_ar: "Arabic string",
    description_en: "60-100 words",
    feature_bullets_en: "optional array of up to 5 strings",
    feature_bullets_ar: "optional array of up to 5 Arabic strings",
  });
  assert.equal("description_ar" in input.output_schema.variants[0], false);
  assert.equal("subtitle_en" in input.output_schema.variants[0], false);
  assert.equal(input.current_noon_product.variants[0].price_sar_initial, undefined);
});

test("applyAiCopyPatch patches only safe copy fields", () => {
  const product = productFixture();

  applyAiCopyPatch(product, {
    product_group_name_en: "Crystal Evening Clutch Bag",
    product_group_name_ar: "حقيبة سهرة مرصعة بالكريستال",
    model_name: "Crystal Evening Clutch",
    category: "Injected Category",
    variants: [
      {
        index: 0,
        title_en: "Crystal Evening Clutch Bag With Chain",
        title_ar: "حقيبة سهرة مرصعة بالكريستال مع سلسلة",
        description_en: "A polished evening clutch for parties, weddings, dinners, and formal occasions.",
        feature_bullets_en: ["Structured clutch shape for evening styling."],
        feature_bullets_ar: ["تصميم منظم مناسب للسهرات."],
        price_sar_initial: 1,
      },
    ],
  });

  assert.equal(product.product_group.product_group_name_en, "Crystal Evening Clutch Bag");
  assert.equal(product.product_group.product_group_name_ar, "حقيبة سهرة مرصعة بالكريستال");
  assert.equal(product.product_group.model_name, "Crystal Evening Clutch");
  assert.equal(product.product_group.category, "Bags & Luggage > Handbag > Clutch");
  assert.equal(product.variants[0].title_en, "Crystal Evening Clutch Bag With Chain");
  assert.equal(product.variants[0].price_sar_initial, 99);
  assert.deepEqual(product.variants[0].feature_bullets_en, ["Structured clutch shape for evening styling."]);
});

test("applyDeepSeekBeautification records success with elapsed seconds", async () => {
  const product = productFixture();
  const logs = [];
  const fetchImpl = async () =>
    new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                product_group_name_en: "Crystal Evening Clutch Bag",
                variants: [{ index: 0, title_en: "Crystal Evening Clutch Bag With Chain" }],
              }),
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );

  await applyDeepSeekBeautification(product, metaFixture(), {
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    fetchImpl,
    timeoutMs: 20000,
    logStep: (scope, message) => logs.push(`[${scope}] ${message}`),
    now: (() => {
      const values = [1000, 9400];
      return () => values.shift() ?? 9400;
    })(),
  });

  assert.equal(product.product_group.product_group_name_en, "Crystal Evening Clutch Bag");
  assert.equal(product.variants[0].title_en, "Crystal Evening Clutch Bag With Chain");
  assert.equal(product.ai_generation.status, "completed");
  assert.equal(product.ai_generation.elapsed_seconds, 8.4);
  assert.match(logs.join("\n"), /轻量文案模式/);
  assert.match(logs.join("\n"), /耗时 8\.4s/);
});

test("applyDeepSeekBeautification times out and keeps rule copy", async () => {
  const product = productFixture();
  const logs = [];
  const fetchImpl = (_url, options = {}) =>
    new Promise((_resolve, reject) => {
      options.signal.addEventListener("abort", () => {
        const error = new Error("The operation was aborted.");
        error.name = "AbortError";
        reject(error);
      });
    });

  await applyDeepSeekBeautification(product, metaFixture(), {
    apiKey: "test-key",
    model: "deepseek-v4-flash",
    fetchImpl,
    timeoutMs: 5,
    logStep: (scope, message) => logs.push(`[${scope}] ${message}`),
    now: (() => {
      const values = [1000, 21100];
      return () => values.shift() ?? 21100;
    })(),
  });

  assert.equal(product.product_group.product_group_name_en, "Rule Evening Bag");
  assert.equal(product.variants[0].title_en, "Rule Gold Evening Bag");
  assert.equal(product.ai_generation.status, "timeout");
  assert.equal(product.ai_generation.fallback, "rule_based_noon_product_kept");
  assert.match(logs.join("\n"), /超时 20\.1s|超时 20\.1 s|超时/);
});

test("applyDeepSeekBeautification keeps rule copy on malformed JSON", async () => {
  const product = productFixture();
  const fetchImpl = async () =>
    new Response(JSON.stringify({ choices: [{ message: { content: "not json" } }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });

  await applyDeepSeekBeautification(product, metaFixture(), {
    apiKey: "test-key",
    fetchImpl,
    timeoutMs: 20000,
    logStep: () => {},
  });

  assert.equal(product.product_group.product_group_name_en, "Rule Evening Bag");
  assert.equal(product.ai_generation.status, "failed");
  assert.equal(product.ai_generation.fallback, "rule_based_noon_product_kept");
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run:

```bash
npm test -- tests/deepseek-copy-beautifier.test.js
```

Expected: fail with module not found for `scripts/lib/deepseek-copy-beautifier.js`.

- [ ] **Step 3: Create the helper module**

Create `scripts/lib/deepseek-copy-beautifier.js`:

```js
export const DEFAULT_DEEPSEEK_COPY_TIMEOUT_MS = 20_000;

export async function applyDeepSeekBeautification(noonProduct, meta, options = {}) {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_DEEPSEEK_COPY_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const logStep = options.logStep ?? (() => {});
  const now = options.now ?? Date.now;
  const startedAt = now();

  if (!apiKey) {
    logStep("deepseek", "未设置 DEEPSEEK_API_KEY，跳过 AI 美化，保留规则生成结果。");
    noonProduct.ai_generation = {
      provider: "deepseek",
      model,
      generated_at: new Date().toISOString(),
      status: "skipped",
      error: "DEEPSEEK_API_KEY is not set.",
      fallback: "rule_based_noon_product_kept",
    };
    return noonProduct;
  }

  logStep("deepseek", `调用模型: ${model}，超时 ${Math.round(timeoutMs / 1000)}s，轻量文案模式`);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetchImpl(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      signal: controller.signal,
      body: JSON.stringify({
        model,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content:
              "You write concise marketplace-safe noon product copy for women's evening clutch bags. Return only valid JSON. Do not include wholesale, supplier, shipping, 1688, factory, MOQ, refund, delivery, or sourcing text.",
          },
          {
            role: "user",
            content: JSON.stringify(buildDeepSeekBeautifyInput(noonProduct, meta)),
          },
        ],
      }),
    });

    const data = await response.json().catch(() => null);

    if (!response.ok) {
      const errorMessage = `DeepSeek API failed: HTTP ${response.status} ${JSON.stringify(data)}`;
      logStep("deepseek", `${errorMessage}，已保留规则生成文案。`);
      recordAiGeneration(noonProduct, { model, status: "failed", startedAt, now, error: errorMessage });
      return noonProduct;
    }

    const patch = parseAiJson(data?.choices?.[0]?.message?.content);
    applyAiCopyPatch(noonProduct, patch);
    const elapsedSeconds = elapsed(startedAt, now);
    noonProduct.ai_generation = {
      provider: "deepseek",
      model,
      generated_at: new Date().toISOString(),
      status: "completed",
      scope: "title_description_bullets_lite",
      elapsed_seconds: elapsedSeconds,
    };
    logStep("deepseek", `已完成标题、描述美化，耗时 ${elapsedSeconds.toFixed(1)}s。`);
    return noonProduct;
  } catch (error) {
    const elapsedSeconds = elapsed(startedAt, now);
    const isTimeout = error?.name === "AbortError";
    const status = isTimeout ? "timeout" : "failed";
    const message = isTimeout
      ? `DeepSeek 超时 ${elapsedSeconds.toFixed(1)}s，已保留规则生成文案。`
      : `DeepSeek 调用失败: ${error.message}，已保留规则生成文案。`;

    logStep("deepseek", message);
    recordAiGeneration(noonProduct, {
      model,
      status,
      startedAt,
      now: () => startedAt + elapsedSeconds * 1000,
      error: error.message,
    });
    return noonProduct;
  } finally {
    clearTimeout(timeout);
  }
}

export function buildDeepSeekBeautifyInput(noonProduct, meta) {
  return {
    task:
      "Improve only high-value marketplace copy for a women's evening clutch product. Keep one variant per source colour. Do not change SKU, barcode, price, stock, colour fields, images, dimensions, weight, category, materials, warehouse, or upload_config.",
    output_schema: {
      product_group_name_en: "string",
      product_group_name_ar: "Arabic string",
      model_name: "string",
      variants: [
        {
          index: "number",
          title_en: "string",
          title_ar: "Arabic string",
          description_en: "60-100 words",
          feature_bullets_en: "optional array of up to 5 strings",
          feature_bullets_ar: "optional array of up to 5 Arabic strings",
        },
      ],
    },
    rules: [
      "English title format: core material or decoration + occasion/style + main bag type + key carry structure.",
      "Arabic title must be natural Arabic marketplace copy and match the English title meaning.",
      "Use truthful copy for dinners, parties, weddings, and formal occasions.",
      "Do not invent waterproofing, scratch resistance, genuine leather, pure silver, real diamonds, luxury branding, adjustable chain, large capacity, or phone compatibility.",
      "Do not mention 1688, Alibaba, wholesale, factory, stock, delivery, refund, shipping, MOQ, cross-border sourcing, or supplier service text.",
      "Feature bullets are optional; return them only if they are concrete and based on source attributes.",
    ],
    source_meta: {
      productId: meta.source?.productId,
      sourceTitle: meta.sourceTitle,
      extractedTitle: meta.title,
      titleParts: meta.titleParts || [],
      productTypeText: meta.productTypeText || "",
      attributes: Object.fromEntries((meta.attributes || []).map((item) => [item.name, item.value])),
      packageInfo: meta.packageInfo,
      dimensions: meta.dimensions,
    },
    current_noon_product: {
      product_group: {
        product_group_name_en: noonProduct.product_group?.product_group_name_en,
        product_group_name_ar: noonProduct.product_group?.product_group_name_ar,
        model_name: noonProduct.product_group?.model_name,
      },
      variants: (noonProduct.variants || []).map((variant, index) => ({
        index,
        colour: variant.colour,
        colour_name: variant.colour_name,
        title_en: variant.title_en,
        title_ar: variant.title_ar,
        description_en: variant.description_en,
        feature_bullets_en: variant.feature_bullets_en,
        feature_bullets_ar: variant.feature_bullets_ar,
      })),
    },
  };
}

export function applyAiCopyPatch(noonProduct, patch) {
  if (isSafeEnglishCopy(patch?.product_group_name_en)) {
    noonProduct.product_group.product_group_name_en = cleanText(patch.product_group_name_en);
  }
  if (isSafeArabicCopy(patch?.product_group_name_ar)) {
    noonProduct.product_group.product_group_name_ar = cleanText(patch.product_group_name_ar);
  }
  if (isSafeEnglishCopy(patch?.model_name)) {
    noonProduct.product_group.model_name = cleanText(patch.model_name);
  }

  for (const item of Array.isArray(patch?.variants) ? patch.variants : []) {
    const index = Number.parseInt(item.index, 10);
    const variant = noonProduct.variants?.[index];

    if (!variant) continue;
    if (isSafeEnglishCopy(item.title_en)) variant.title_en = cleanText(item.title_en);
    if (isSafeArabicCopy(item.title_ar)) variant.title_ar = cleanText(item.title_ar);
    if (isSafeEnglishCopy(item.description_en)) variant.description_en = cleanText(item.description_en);
    if (Array.isArray(item.feature_bullets_en)) {
      const bullets = item.feature_bullets_en.map(cleanText).filter(isSafeEnglishCopy).slice(0, 5);
      if (bullets.length > 0) variant.feature_bullets_en = bullets;
    }
    if (Array.isArray(item.feature_bullets_ar)) {
      const bullets = item.feature_bullets_ar.map(cleanText).filter(isSafeArabicCopy).slice(0, 5);
      if (bullets.length > 0) variant.feature_bullets_ar = bullets;
    }
  }

  return noonProduct;
}

function parseAiJson(content) {
  const text = cleanText(content);
  const jsonText = text.startsWith("{") ? text : text.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) throw new Error("DeepSeek response did not contain JSON.");
  return JSON.parse(jsonText);
}

function recordAiGeneration(noonProduct, { model, status, startedAt, now, error }) {
  noonProduct.ai_generation = {
    provider: "deepseek",
    model,
    generated_at: new Date().toISOString(),
    status,
    error,
    fallback: "rule_based_noon_product_kept",
    elapsed_seconds: elapsed(startedAt, now),
  };
}

function elapsed(startedAt, now) {
  return Math.round(((now() - startedAt) / 1000) * 10) / 10;
}

function isSafeEnglishCopy(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/[\u3400-\u9fff]/.test(text)) return false;
  if (/\b(1688|alibaba|wholesale|factory|supplier|shipping|delivery|refund|moq)\b/i.test(text)) return false;
  return /[A-Za-z]/.test(text);
}

function isSafeArabicCopy(value) {
  const text = cleanText(value);
  if (!text) return false;
  if (/[\u3400-\u9fff]/.test(text)) return false;
  if (/\b(1688|alibaba|wholesale|factory|supplier|shipping|delivery|refund|moq)\b/i.test(text)) return false;
  return /[\u0600-\u06ff]/.test(text);
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
```

- [ ] **Step 4: Run helper tests**

Run:

```bash
npm test -- tests/deepseek-copy-beautifier.test.js
```

Expected: pass all tests in `tests/deepseek-copy-beautifier.test.js`.

- [ ] **Step 5: Commit Task 1**

```bash
git add scripts/lib/deepseek-copy-beautifier.js tests/deepseek-copy-beautifier.test.js
git commit -m "Add DeepSeek copy timeout helper"
```

---

### Task 2: Wire Helper Into Collector

**Files:**
- Modify: `scripts/collect-1688.js`
- Test: `tests/deepseek-copy-beautifier.test.js`
- Test: `tests/noon-product-summary.test.js`
- Test: `tests/noon-operation-checks.test.js`
- Test: `tests/noon-upload-product.test.js`

**Interfaces:**
- Consumes: `applyDeepSeekBeautification(noonProduct, meta, { logStep })`
- Produces: unchanged `generateNoonProductFromMeta(..., { beautify: true })` behavior, except DeepSeek is timeout-bounded and uses the lightweight helper.

- [ ] **Step 1: Import the helper**

In `scripts/collect-1688.js`, add this import near the other `./lib/*` imports:

```js
import { applyDeepSeekBeautification } from "./lib/deepseek-copy-beautifier.js";
```

- [ ] **Step 2: Pass the existing logger into the helper**

Replace the existing call:

```js
await applyDeepSeekBeautification(noonProduct, meta);
```

with:

```js
await applyDeepSeekBeautification(noonProduct, meta, { logStep });
```

- [ ] **Step 3: Delete the old local text-copy DeepSeek helpers**

Remove these functions from `scripts/collect-1688.js` after the imported helper is wired:

```text
applyDeepSeekBeautification
buildDeepSeekBeautifyInput
applyAiCopyPatch
isSafeEnglishCopy
isSafeArabicCopy
```

Keep `parseAiJson` in `scripts/collect-1688.js` because image vision still uses it. Keep the image vision functions unchanged:

```text
classifyColourImagesWithDeepSeek
classifyDimensionsWithDeepSeek
isDeepSeekImageVisionEnabled
```

- [ ] **Step 4: Run syntax and helper tests**

Run:

```bash
node --check scripts/collect-1688.js
npm test -- tests/deepseek-copy-beautifier.test.js
```

Expected: `node --check` exits 0 and the helper tests pass.

- [ ] **Step 5: Commit Task 2**

```bash
git add scripts/collect-1688.js
git commit -m "Use timeout-bounded DeepSeek copy helper"
```

---

### Task 3: Verify Existing Generation Surface

**Files:**
- Test only: `tests/deepseek-copy-beautifier.test.js`
- Test only: `tests/noon-product-summary.test.js`
- Test only: `tests/noon-operation-checks.test.js`
- Test only: `tests/noon-upload-product.test.js`

**Interfaces:**
- Consumes: wired collector from Task 2.
- Produces: verification evidence that existing product generation surfaces still pass.

- [ ] **Step 1: Run focused tests**

Run:

```bash
npm test -- tests/deepseek-copy-beautifier.test.js tests/noon-product-summary.test.js tests/noon-operation-checks.test.js tests/noon-upload-product.test.js
```

Expected: selected tests pass. If `tests/noon-operation-checks.test.js` does not exist in the current checkout, run:

```bash
npm test -- tests/deepseek-copy-beautifier.test.js tests/noon-product-summary.test.js tests/noon-upload-product.test.js
```

- [ ] **Step 2: Run full test suite if focused tests pass**

Run:

```bash
npm test
```

Expected: full `node --test` suite passes, or failures are clearly unrelated existing workspace issues and documented in the final handoff.

- [ ] **Step 3: Manual timeout smoke test**

Run a local delayed endpoint in a temporary terminal:

```bash
node -e 'const server=require("node:http").createServer((req,res)=>setTimeout(()=>res.end(JSON.stringify({choices:[]})),30000)); server.listen(9123,()=>console.log("slow deepseek mock on 9123"));'
```

In another terminal, run a real product meta if one exists:

```bash
DEEPSEEK_API_KEY=test-key DEEPSEEK_BASE_URL=http://127.0.0.1:9123 node scripts/collect-1688.js --from-meta products/1688/default/1001/meta.json --deepseek true
```

Expected: logs show `调用模型...超时 20s，轻量文案模式`, then `DeepSeek 超时 ... 已保留规则生成文案。`, and the process still writes `noon-product-attributes.json`.

If `products/1688/default/1001/meta.json` does not exist, skip this manual check and report that no stable local product fixture was available.

- [ ] **Step 4: Commit verification notes only if code changed during fixes**

If verification required code changes, commit them:

```bash
git add scripts/lib/deepseek-copy-beautifier.js scripts/collect-1688.js tests/deepseek-copy-beautifier.test.js
git commit -m "Fix DeepSeek timeout verification issues"
```

If no code changed, do not create an empty commit.
