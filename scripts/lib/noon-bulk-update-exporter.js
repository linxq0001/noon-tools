import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

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

export async function exportNoonBulkUpdates({
  productsDir,
  outputDir,
  platform = "",
  repository = "",
  catalogType = "global",
  productDirs = [],
  partnerSkuByProductDir = {},
  append = false,
}) {
  const products = filterProductsByDir(await readNoonProducts(productsDir, { platform, repository }), productDirs);
  const skippedProducts = products
    .filter((product) => hasBlockingOperationCheck(product.noonAttributes))
    .map((product) => ({ source: product.relativeDir, reason: "blocking_operation_check" }));
  const exportableProducts = products.filter((product) => !hasBlockingOperationCheck(product.noonAttributes));
  const { products: uniqueProducts, duplicateProducts } = dedupeProducts(exportableProducts);
  const allRows = uniqueProducts
    .flatMap((product) => toSkuRows(product, { platform, catalogType, partnerSkuByProductDir }))
    .filter((row) => row.partnerSku);
  const { rows, duplicateSkus } = dedupeSkuRows(allRows);

  await mkdir(outputDir, { recursive: true });

  const files = {
    product: path.join(outputDir, bulkUpdateFileNames.product),
    price: path.join(outputDir, bulkUpdateFileNames.price),
    stock: path.join(outputDir, bulkUpdateFileNames.stock),
  };

  writeWorkbook(files.product, "Global Product Update", productRows(rows), { append });
  writeWorkbook(files.price, "Global Price Update", priceRows(rows), { append });
  writeWorkbook(files.stock, "Stock Import", stockRows(rows), { append });

  return {
    skuCount: rows.length,
    productCount: uniqueProducts.length,
    duplicateProducts,
    duplicateSkus,
    skippedProducts,
    files,
  };
}

export function verifyBulkUpdatePartnerSkus(files, expectedSkus) {
  const skus = [...new Set((Array.isArray(expectedSkus) ? expectedSkus : []).map(cleanText).filter(Boolean))];
  const missing = [];

  for (const file of ["product", "price", "stock"]) {
    const writtenSkus = readPartnerSkus(files[file]);
    for (const partnerSku of skus) {
      if (!writtenSkus.has(partnerSku)) missing.push({ file, partnerSku });
    }
  }

  return { ok: missing.length === 0, expectedSkus: skus, missing };
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

function toSkuRows(product, { platform = "", catalogType = "global", partnerSkuByProductDir = {} } = {}) {
  const group = product.noonAttributes.product_group ?? {};
  const uploadConfig = product.noonAttributes.upload_config ?? {};
  const variants = Array.isArray(product.noonAttributes.variants) ? product.noonAttributes.variants : [];
  const operationStatus = cleanText(product.noonAttributes.operation_status) || "active";
  const uploadedPartnerSkus = partnerSkuOverridesForProduct(product.relativeDir, partnerSkuByProductDir);
  const exportVariants = uploadedPartnerSkus.length > 0
    ? variants.filter((variant) => uploadedPartnerSkus.some((sku) => isUploadedVariantSku(variant.partner_sku, sku, { platform, catalogType })))
    : variants;

  return exportVariants.map((variant, index) => ({
    source: product.relativeDir,
    partnerSku: uploadedPartnerSkus.length > 0
      ? uploadedPartnerSkus.find((sku) => isUploadedVariantSku(variant.partner_sku, sku, { platform, catalogType }))
      : catalogPartnerSku(variant.partner_sku, { platform, catalogType }),
    barcode: cleanText(variant.barcode),
    colour: cleanText(variant.colour || variant.colour_name),
    titleEn: cleanText(variant.title_en),
    titleAr: cleanText(variant.title_ar),
    images: normalizeImages(valueFor(variant, group, "images", [])),
    countryCode: cleanText(uploadConfig.country_code) || "sa",
    idPartner: cleanText(uploadConfig.id_partner) || "517205",
    hsCode: cleanText(group.hs_code),
    countryOfOrigin: countryCode(group.country_of_origin),
    vmWeightCm: blankNull(valueFor(variant, group, "vm_weight_cm", volumetricWeight({ ...group, ...variant }))),
    weightKg: blankNull(valueFor(variant, group, "actual_weight_kg")),
    lengthCm: blankNull(valueFor(variant, group, "length_cm")),
    widthCm: blankNull(valueFor(variant, group, "width_cm")),
    heightCm: blankNull(valueFor(variant, group, "height_cm")),
    priceUsd: blankNull(valueFor(variant, group, "price_usd")),
    stock: operationStatus === "inactive" ? 0 : blankNull(valueFor(variant, group, "stock")),
    processingTime: cleanText(valueFor(variant, group, "processing_time")) || "2_days",
    warehouseCode: cleanText(valueFor(variant, group, "warehouse_code", uploadConfig.warehouse_code)) || "W00183886CN",
    operationStatus,
  }));
}

function hasBlockingOperationCheck(noonAttributes) {
  return (noonAttributes.operation_check?.blockingIssues || []).length > 0;
}

function filterProductsByDir(products, productDirs) {
  const filters = (Array.isArray(productDirs) ? productDirs : []).map(cleanRelativeDir).filter(Boolean);
  if (filters.length === 0) return products;
  return products.filter((product) => filters.some((filter) => relativeDirMatches(product.relativeDir, filter)));
}

function relativeDirMatches(relativeDir, filter) {
  const source = cleanRelativeDir(relativeDir);
  return source === filter || filter.endsWith(`/${source}`) || source.endsWith(`/${filter}`);
}

function cleanRelativeDir(value) {
  return cleanText(value).replace(/^products\//, "").replace(/^1688\//, "");
}

function valueFor(variant, group, field, fallback = undefined) {
  return variant[field] ?? group[field] ?? fallback;
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

function writeWorkbook(filePath, sheetName, rows, { append = false } = {}) {
  const outputRows = append ? appendWorkbookRows(filePath, rows) : rows;
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(outputRows), sheetName);
  XLSX.writeFile(workbook, filePath);
}

function appendWorkbookRows(filePath, rows) {
  const newRows = rows.slice(1);
  if (newRows.length === 0) return existingWorkbookRows(filePath) ?? rows;
  const existingRows = existingWorkbookRows(filePath);
  if (!existingRows) return rows;
  return [...existingRows, ...newRows];
}

function existingWorkbookRows(filePath) {
  try {
    const workbook = XLSX.readFile(filePath);
    return XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
  } catch {
    return null;
  }
}

function partnerSkuOverridesForProduct(relativeDir, partnerSkuByProductDir) {
  const key = cleanText(relativeDir);
  const exact = cleanSkuList(partnerSkuByProductDir[key]);
  if (exact.length > 0) return exact;

  const suffix = `/${key}`;
  const match = Object.entries(partnerSkuByProductDir).find(([productDir]) => cleanText(productDir).endsWith(suffix));
  return cleanSkuList(match?.[1]);
}

function cleanSkuList(value) {
  return (Array.isArray(value) ? value : [value]).map(cleanText).filter(Boolean);
}

function isUploadedVariantSku(baseSku, uploadedSku, options) {
  const base = catalogPartnerSku(baseSku, options);
  const uploaded = cleanText(uploadedSku);
  return uploaded === base || uploaded.startsWith(`${base}-`);
}

function readPartnerSkus(filePath) {
  const workbook = XLSX.readFile(filePath);
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { header: 1, defval: "" });
  const header = rows[0] ?? [];
  const index = header.indexOf("partner_sku");
  if (index < 0) return new Set();
  return new Set(rows.slice(1).map((row) => cleanText(row[index])).filter(Boolean));
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
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
