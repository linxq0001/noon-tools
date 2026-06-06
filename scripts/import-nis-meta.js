#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import XLSX from "xlsx";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const workbookPath = args._[0] ? path.resolve(args._[0]) : "";
const outDir = path.resolve(rootDir, args.out ?? "products");

if (!workbookPath) {
  console.error("Usage: npm run import:nis-meta -- <NIS.xlsx> [--out products] [--dry-run true]");
  process.exit(1);
}

const products = readNisProducts(workbookPath);

if (args["dry-run"] === "true") {
  console.log(JSON.stringify({ count: products.length, products }, null, 2));
  process.exit(0);
}

await mkdir(outDir, { recursive: true });

for (const product of products) {
  const productDir = path.join(outDir, safeFileName(`${product.productId}-${product.title || "NIS product"}`));
  await mkdir(productDir, { recursive: true });
  await writeJson(path.join(productDir, "meta.json"), product);
}

console.log(`Imported ${products.length} product meta file(s) to ${path.relative(rootDir, outDir) || outDir}`);

function readNisProducts(filePath) {
  const workbook = XLSX.readFile(filePath, { cellDates: false });
  const sheet = workbook.Sheets.template_data ?? workbook.Sheets[workbook.SheetNames[0]];
  if (!sheet) throw new Error("Workbook does not contain any sheets.");

  const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true });
  const headerIndex = rows.findIndex((row) => row.includes("Partner SKU Unique") && row.includes("Product Title EN"));
  if (headerIndex === -1) throw new Error("Could not find the NIS header row.");

  const headers = rows[headerIndex].map((value) => cleanText(value));
  const products = [];

  for (let rowIndex = headerIndex + 1; rowIndex < rows.length; rowIndex += 1) {
    const values = rowToObject(headers, rows[rowIndex]);
    if (isFieldCodeRow(values)) continue;
    if (!hasProductData(values)) continue;

    products.push(toMeta(values, rowIndex + 1));
  }

  return products;
}

function toMeta(values, sourceRow) {
  const rawProductId = cleanText(values["Partner SKU Unique"]);
  const rawTitle = cleanText(values["Product Title EN"]);
  const productId = rawProductId || `nis-row-${sourceRow}`;
  const title =
    rawTitle ||
    cleanText(values["Product Subtype"]) ||
    cleanText(values["Product Type"]) ||
    cleanText(values.Family) ||
    "NIS product";
  const category = {
    family: cleanText(values.Family),
    productType: cleanText(values["Product Type"]),
    productSubtype: cleanText(values["Product Subtype"]),
  };
  const images = collectNumbered(values, "Image URL");
  const featureBulletsEn = collectNumbered(values, "Feature Bullet", "EN");
  const weightG = toGrams(values["Shipping Weight"], values["Shipping Weight Unit"]);

  return removeEmpty({
    productId,
    title,
    sourceTitle: title,
    sourceUrl: "",
    category,
    attributes: {},
    images,
    packageInfo: removeEmpty({ weightG }),
    price: cleanText(values["Recommended Retail Price AE"]),
    missingFields: [
      rawProductId ? "" : "Partner SKU Unique",
      rawTitle ? "" : "Product Title EN",
    ].filter(Boolean),
    noon: removeEmpty({
      source: "NIS",
      sourceRow,
      brand: cleanText(values.Brand),
      productTitleAr: cleanText(values["Product Title AR"]),
      gtin: cleanText(values.GTIN),
      featureBulletsEn,
      attributes: collectNoonAttributes(values),
    }),
  });
}

function collectNoonAttributes(values) {
  const skipped = new Set([
    "Family",
    "Product Type",
    "Product Subtype",
    "Brand",
    "Product Title EN",
    "Product Title AR",
    "Partner SKU Unique",
    "GTIN",
    "Shipping Weight",
    "Shipping Weight Unit",
    "Recommended Retail Price AE",
  ]);
  const attributes = {};

  for (const [key, value] of Object.entries(values)) {
    if (skipped.has(key)) continue;
    if (/^Image URL \d+$/i.test(key)) continue;
    if (/^Feature Bullet \d+ EN$/i.test(key)) continue;
    if (/^Feature Bullet \d+ AR$/i.test(key)) continue;
    const cleaned = cleanText(value);
    if (cleaned) attributes[key] = cleaned;
  }

  return attributes;
}

function collectNumbered(values, prefix, suffix = "") {
  const pattern = new RegExp(`^${escapeRegExp(prefix)} (\\d+)${suffix ? ` ${escapeRegExp(suffix)}` : ""}$`, "i");

  return Object.entries(values)
    .filter(([key]) => pattern.test(key))
    .sort(([left], [right]) => Number(left.match(pattern)[1]) - Number(right.match(pattern)[1]))
    .map(([, value]) => cleanText(value))
    .filter(Boolean);
}

function toGrams(weight, unit) {
  const value = Number.parseFloat(String(weight).replace(/,/g, ""));
  if (!Number.isFinite(value)) return "";

  const normalizedUnit = cleanText(unit).toLowerCase();
  if (normalizedUnit === "kg") return String(Math.round(value * 1000));
  if (normalizedUnit === "grams" || normalizedUnit === "gram" || normalizedUnit === "g") return String(Math.round(value));

  return cleanText(weight);
}

function rowToObject(headers, row) {
  const values = {};

  headers.forEach((header, index) => {
    if (header) values[header] = row[index] ?? "";
  });

  return values;
}

function isFieldCodeRow(values) {
  return cleanText(values["Partner SKU Unique"]) === "seller_sku";
}

function hasProductData(values) {
  return Object.values(values).some((value) => cleanText(value));
}

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

function removeEmpty(value) {
  if (Array.isArray(value)) return value.filter(Boolean);
  const output = {};

  for (const [key, item] of Object.entries(value)) {
    if (Array.isArray(item) && item.length === 0) continue;
    if (item && typeof item === "object" && !Array.isArray(item)) {
      const cleaned = removeEmpty(item);
      if (Object.keys(cleaned).length > 0) output[key] = cleaned;
      continue;
    }
    if (item !== "") output[key] = item;
  }

  return output;
}

function safeFileName(value) {
  return cleanText(value)
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function writeJson(filePath, data) {
  return writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function parseArgs(argv) {
  const parsed = { _: [] };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
      continue;
    }

    parsed[key] = next;
    index += 1;
  }

  return parsed;
}
