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
      if (!hasMetaField(meta, field)) {
        blockingIssues.push(issue(`missing_${field}`, `meta.json 缺少 ${field}。`));
      }
    }
  }

  if (!noon) {
    blockingIssues.push(issue("missing_noon_attributes", "noon-product-attributes.json 不可读取。"));
    return normalizeOperationCheck({
      productDir,
      blockingIssues,
      warnings,
      profit: calculateNoonProfit(profitInput(meta, [], profitConfig)),
      variantCount: 0,
      skuCount: 0,
    });
  }

  const group = noon.product_group || {};
  if (!hasValue(group.product_group_name_en)) blockingIssues.push(issue("missing_title_en", "缺少英文标题。"));
  if (!hasValue(group.product_group_name_ar)) blockingIssues.push(issue("missing_title_ar", "缺少阿拉伯语标题。"));
  if (!hasValue(group.category) && !hasValue(group.category_code)) {
    blockingIssues.push(issue("missing_category", "缺少类目字段。"));
  }

  const variants = Array.isArray(noon.variants) ? noon.variants : [];
  if (variants.length === 0) blockingIssues.push(issue("missing_variants", "缺少 variants。"));

  const otherSkus = new Map();
  const otherBarcodes = new Map();
  for (const other of allProducts) {
    if (!other || other.productDir === productDir) continue;
    for (const variant of Array.isArray(other.noon?.variants) ? other.noon.variants : []) {
      if (hasValue(variant.partner_sku)) otherSkus.set(String(variant.partner_sku), other.productDir);
      if (hasValue(variant.barcode)) otherBarcodes.set(String(variant.barcode), other.productDir);
    }
  }

  const referencedImages = new Set(normalizeImages(meta?.images));
  for (const [index, variant] of variants.entries()) {
    const label = `variant ${index + 1}`;

    for (const field of requiredVariantFields) {
      if (!hasValue(variant[field])) {
        blockingIssues.push(issue(`missing_${field}`, `${label} 缺少 ${field}。`));
      }
    }

    if (hasValue(variant.partner_sku) && otherSkus.has(String(variant.partner_sku))) {
      blockingIssues.push(issue("duplicate_partner_sku", `${label} 的 partner_sku 与 ${otherSkus.get(String(variant.partner_sku))} 重复。`));
    }
    if (hasValue(variant.barcode) && otherBarcodes.has(String(variant.barcode))) {
      blockingIssues.push(issue("duplicate_barcode", `${label} 的 barcode 与 ${otherBarcodes.get(String(variant.barcode))} 重复。`));
    }

    const variantImages = normalizeImages(variant.images);
    if (variantImages.length < 3) warnings.push(issue("low_image_count", `${label} 少于 3 张图片。`));
    for (const imagePath of variantImages) referencedImages.add(imagePath);
  }

  for (const imagePath of referencedImages) {
    if (!imageExists(path.join(productRoot, imagePath))) {
      blockingIssues.push(issue("missing_image_file", `引用的图片不存在: ${imagePath}`));
      break;
    }
  }

  const profit = calculateNoonProfit(profitInput(meta, variants, profitConfig));
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
    checkedAt: String(result.checkedAt || new Date().toISOString()),
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
  const resolvedProductsDir = path.resolve(productsDir);
  const fullPath = path.resolve(productsDir, productDir);
  const basePath = `${resolvedProductsDir}${path.sep}`;
  if (fullPath !== resolvedProductsDir && !fullPath.startsWith(basePath)) {
    throw new Error("Invalid productDir");
  }
  return fullPath;
}

function profitInput(meta, variants, profitConfig) {
  return {
    ...profitConfig,
    costCny: hasValue(profitConfig.costCny) ? profitConfig.costCny : meta?.price,
    salePriceAed: firstValue(variants.map((variant) => variant.price_usd ?? variant.price)),
  };
}

function hasMetaField(meta, field) {
  if (field === "sourceUrl") return hasValue(meta.sourceUrl) || hasValue(meta.source?.url);
  return hasValue(meta[field]);
}

function normalizeImages(images) {
  return [...new Set((Array.isArray(images) ? images : []).map(imagePath).filter(hasValue))];
}

function imagePath(image) {
  if (typeof image === "string") return image;
  if (image && typeof image === "object") return image.path || image.url || "";
  return "";
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
