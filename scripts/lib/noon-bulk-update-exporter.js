import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";
import { cleanText } from "./text-utils.js";

export const bulkUpdateFileNames = {
  product: "global-product-update.xlsx",
  price: "global-price-update.xlsx",
  stock: "stock-import.xlsx",
};

const platformIds = {
  "1688": "1001",
  amazon: "1002",
  "亚马逊": "1002",
  pinduoduo: "1003",
  pdd: "1003",
  "拼多多": "1003",
  noon: "1004",
};

const platformIdValues = new Set(Object.values(platformIds));

const catalogPrefixes = {
  noon: "N",
  supermall: "S",
  global: "G",
};

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

async function readNoonProducts(productsDir, { platform = "", repository = "" } = {}) {
  const roots = platform
    ? [repository ? path.join(productsDir, platform, repository) : path.join(productsDir, platform)]
    : repository
      ? [path.join(productsDir, defaultPlatformName(), repository), path.join(productsDir, repository)]
      : [productsDir];
  const products = [];

  for (const root of roots) {
    products.push(...(await readProductsUnder(root)));
  }

  return products.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

function defaultPlatformName() {
  return "1688";
}

async function readProductsUnder(dir, prefix = "") {
  let entries = [];

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const directProduct = await readJsonIfExists(path.join(dir, "noon-product-attributes.json"));
  if (directProduct) {
    return [{ relativeDir: prefix || path.basename(dir), noonAttributes: directProduct }];
  }

  const products = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const childPrefix = prefix ? `${prefix}/${entry.name}` : entry.name;
    products.push(...(await readProductsUnder(path.join(dir, entry.name), childPrefix)));
  }
  return products;
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

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

function hasBlockingOperationCheck(noonAttributes) {
  return (noonAttributes.operation_check?.blockingIssues || []).length > 0;
}

function catalogPartnerSku(partnerSku, { platform = "", catalogType = "global" } = {}) {
  const sku = cleanText(partnerSku);
  if (!sku) return "";

  const hasCatalogPrefix = /^[GNS]-/.test(sku);
  const sourceSku = hasCatalogPrefix ? sku.slice(2) : sku;
  const parts = sourceSku.split("-");
  const platformPart = parts[0];
  const sourcePlatform =
    platformIds[platformPart] || (hasCatalogPrefix && platformIdValues.has(platformPart))
      ? parts.shift()
      : cleanText(platform) || defaultPlatformName();
  const platformId = platformIds[sourcePlatform] || sourcePlatform;
  const prefix = catalogPrefixes[catalogType] || catalogPrefixes.global;

  return `${prefix}-${platformId}-${parts.join("-")}`;
}

function dedupeProducts(products) {
  const byProduct = new Map();
  const duplicateProducts = [];

  for (const product of products) {
    const productKey = productIdentity(product.relativeDir);
    const current = byProduct.get(productKey);
    if (!current) {
      byProduct.set(productKey, product);
      continue;
    }

    const existing = duplicateProducts.find((item) => item.productKey === productKey);
    if (existing) {
      existing.sources.push(product.relativeDir);
    } else {
      duplicateProducts.push({ productKey, sources: [current.relativeDir, product.relativeDir] });
    }
  }

  return { products: [...byProduct.values()], duplicateProducts };
}

function productIdentity(relativeDir) {
  const leaf = path.basename(relativeDir);
  return leaf.match(/^\d+/)?.[0] || relativeDir;
}

function dedupeSkuRows(rows) {
  const bySku = new Map();
  const duplicateSkus = [];

  for (const row of rows) {
    const current = bySku.get(row.partnerSku);
    if (!current) {
      bySku.set(row.partnerSku, row);
      continue;
    }

    if (current.source !== row.source && skuContentKey(current) !== skuContentKey(row)) {
      throw new Error(`Conflicting duplicate SKU ${row.partnerSku}: ${current.source}, ${row.source}`);
    }

    addDuplicateSku(duplicateSkus, row.partnerSku, current.source, row.source);
  }

  return { rows: [...bySku.values()], duplicateSkus };
}

function addDuplicateSku(duplicateSkus, partnerSku, ...sources) {
  const existing = duplicateSkus.find((item) => item.partnerSku === partnerSku);
  if (existing) {
    for (const source of sources) {
      if (!existing.sources.includes(source)) existing.sources.push(source);
    }
    return;
  }

  duplicateSkus.push({ partnerSku, sources: [...new Set(sources)] });
}

function skuContentKey(row) {
  return JSON.stringify({
    barcode: row.barcode,
    colour: row.colour,
    priceUsd: row.priceUsd,
    stock: row.stock,
    lengthCm: row.lengthCm,
    widthCm: row.widthCm,
    heightCm: row.heightCm,
    weightKg: row.weightKg,
    titleEn: row.titleEn,
    titleAr: row.titleAr,
    images: row.images,
  });
}

function normalizeImages(images) {
  return (Array.isArray(images) ? images : [])
    .map((image) => (typeof image === "string" ? image : image?.path || ""))
    .filter(Boolean);
}

function productRows(rows) {
  return [
    [
      "partner_sku",
      "hs_code",
      "vm_weight_cm",
      "actual_weight_kg",
      "width_cm",
      "height_cm",
      "country_of_origin",
    ],
    ...rows.map((row) => [
      row.partnerSku,
      row.hsCode,
      row.vmWeightCm,
      row.weightKg,
      row.widthCm,
      row.heightCm,
      row.countryOfOrigin,
    ]),
  ];
}

function priceRows(rows) {
  return [
    ["partner_sku", "country_code", "price_usd", "is_active"],
    ...rows.map((row) => [row.partnerSku, row.countryCode, row.priceUsd, row.operationStatus === "inactive" ? "FALSE" : "TRUE"]),
  ];
}

function stockRows(rows) {
  return [
    [
      "country_code",
      "id_partner",
      "partner_sku",
      "noon_warehouse_code",
      "current_stock_gross",
      "current_processing_time",
      "stock_gross",
      "processing_time",
    ],
    ...rows.map((row) => [
      row.countryCode,
      row.idPartner,
      row.partnerSku,
      row.warehouseCode,
      row.stock,
      row.processingTime,
      row.stock,
      row.processingTime,
    ]),
  ];
}

function writeWorkbook(filePath, sheetName, rows) {
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), sheetName);
  XLSX.writeFile(workbook, filePath);
}

function blankNull(value) {
  return value === null || value === undefined ? "" : value;
}

function countryCode(value) {
  const text = cleanText(value);
  if (/^china$/i.test(text)) return "CN";
  return text;
}

function volumetricWeight(variant) {
  const length = numberValue(variant.length_cm);
  const width = numberValue(variant.width_cm);
  const height = numberValue(variant.height_cm);

  if (!length || !width || !height) return "";
  return Number(((length * width * height) / 6000).toFixed(3));
}

function numberValue(value) {
  const number = Number.parseFloat(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(number) ? number : 0;
}
