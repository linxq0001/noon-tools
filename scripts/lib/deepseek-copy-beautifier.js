export const DEFAULT_DEEPSEEK_COPY_TIMEOUT_MS = 20_000;

export async function applyDeepSeekBeautification(noonProduct, meta, options = {}) {
  const apiKey = options.apiKey ?? process.env.DEEPSEEK_API_KEY;
  const model = options.model ?? process.env.DEEPSEEK_MODEL ?? "deepseek-v4-flash";
  const baseUrl = (options.baseUrl ?? process.env.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com").replace(/\/+$/, "");
  const timeoutMs = Number.isFinite(options.timeoutMs) ? options.timeoutMs : DEFAULT_DEEPSEEK_COPY_TIMEOUT_MS;
  const fetchImpl = options.fetchImpl ?? globalThis.fetch;
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
