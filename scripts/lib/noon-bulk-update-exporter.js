import { mkdir, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import XLSX from "xlsx";

export const bulkUpdateFileNames = {
  product: "global-product-update.xlsx",
  price: "global-price-update.xlsx",
  stock: "stock-import.xlsx",
};

export async function exportNoonBulkUpdates({ productsDir, outputDir, repository = "" }) {
  const products = await readNoonProducts(productsDir, repository);
  const rows = products.flatMap(toSkuRows).filter((row) => row.partnerSku);

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
    productCount: products.length,
    files,
  };
}

async function readNoonProducts(productsDir, repository) {
  const roots = repository ? [path.join(productsDir, repository)] : [productsDir];
  const products = [];

  for (const root of roots) {
    products.push(...(await readProductsUnder(root)));
  }

  return products.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
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

function toSkuRows(product) {
  const group = product.noonAttributes.product_group ?? {};
  const uploadConfig = product.noonAttributes.upload_config ?? {};
  const variants = Array.isArray(product.noonAttributes.variants) ? product.noonAttributes.variants : [];

  return variants.map((variant) => ({
    partnerSku: cleanText(variant.partner_sku),
    countryCode: cleanText(uploadConfig.country_code) || "sa",
    idPartner: cleanText(uploadConfig.id_partner) || "517205",
    hsCode: cleanText(group.hs_code),
    countryOfOrigin: countryCode(group.country_of_origin),
    vmWeightCm: blankNull(variant.vm_weight_cm ?? volumetricWeight(variant)),
    weightKg: blankNull(variant.actual_weight_kg),
    widthCm: blankNull(variant.width_cm),
    heightCm: blankNull(variant.height_cm),
    priceUsd: blankNull(variant.price_usd),
    stock: blankNull(variant.stock),
    processingTime: cleanText(variant.processing_time) || "2_days",
    warehouseCode: cleanText(variant.warehouse_code || uploadConfig.warehouse_code) || "W00183886CN",
  }));
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
    ...rows.map((row) => [row.partnerSku, row.countryCode, row.priceUsd, "TRUE"]),
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
