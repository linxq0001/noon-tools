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
