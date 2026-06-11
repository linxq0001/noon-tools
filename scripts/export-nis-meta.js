#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import XLSX from "xlsx";
import { imageUrlsForSku } from "./lib/publishable-images.js";
import { readProductDirs } from "./lib/product-storage.js";

const run = promisify(execFile);

const args = process.argv.slice(2);
const positionalArgs = positional(args);
const productsDir = positionalArgs[0] ? path.resolve(positionalArgs[0]) : "";
const templatePath = positionalArgs[1] ? path.resolve(positionalArgs[1]) : "";
const outputPath = positionalArgs[2] ? path.resolve(positionalArgs[2]) : "";
const imageManifestPath = optionValue("--image-manifest");

if (!productsDir || !templatePath || !outputPath) {
  console.error("Usage: npm run export:nis-meta -- <products-dir> <NIS-template.xlsx> <output.xlsx> [--image-manifest <manifest.json>]");
  process.exit(1);
}

const products = await readProducts(productsDir);
const imageManifest = imageManifestPath ? JSON.parse(await readFile(path.resolve(imageManifestPath), "utf8")) : null;
const workbook = XLSX.readFile(templatePath, { cellDates: false });
const sheet = workbook.Sheets.template_data ?? workbook.Sheets[workbook.SheetNames[0]];
if (!sheet) throw new Error("Workbook does not contain any sheets.");

const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: "", blankrows: true });
const headerIndex = rows.findIndex((row) => row.includes("Partner SKU Unique") && row.includes("Product Title EN"));
if (headerIndex === -1) throw new Error("Could not find the NIS header row.");

const headers = rows[headerIndex].map(cleanText);
const dropdownValidators = buildDropdownValidators(workbook, rows, headerIndex);
const nisRows = uniqueRowsBySku(products.flatMap((product) => toNisRows(product, imageManifest)));
const dataRows = nisRows
  .map((product) => headers.map((header, index) => validateDropdownValue(product[header] ?? "", dropdownValidators[index])));
await mkdir(path.dirname(outputPath), { recursive: true });
await writeTemplateCopy(templatePath, outputPath, "template_data", headerIndex + 2, headers.length, dataRows);

console.log(`Exported ${dataRows.length} NIS row(s) to ${outputPath}`);

function uniqueRowsBySku(rows) {
  const seen = new Set();
  return rows.filter((row) => {
    const sku = cleanText(row["Partner SKU Unique"]);
    if (!sku) return true;
    const canonical = sku.toLowerCase();
    if (seen.has(canonical)) return false;
    seen.add(canonical);
    return true;
  });
}

async function readProducts(dir) {
  const products = [];

  for (const product of await readProductDirs(dir)) {
    const productDir = product.fullPath;
    const meta = await readJsonIfExists(path.join(productDir, "meta.json"));
    if (!meta) continue;
    const noonAttributes = (await readJsonIfExists(path.join(productDir, "noon-product-attributes.json"))) ?? {};
    products.push({ meta, noonAttributes });
  }

  return products.sort((left, right) => cleanText(left.meta.productId).localeCompare(cleanText(right.meta.productId)));
}

function buildDropdownValidators(workbook, rows, headerIndex) {
  const fieldCodes = rows[headerIndex + 1].map(cleanText);
  const definedNames = new Map((workbook.Workbook?.Names ?? []).map((name) => [name.Name, name.Ref]));

  return fieldCodes.map((fieldCode) => {
    const ref = definedNames.get(`valid_values_${fieldCode}`);
    if (!ref) return null;
    const allowed = readDefinedRangeValues(workbook, ref).filter((value) => normalizeDropdown(value) !== "no option available");
    return allowed.length ? allowed : null;
  });
}

function readDefinedRangeValues(workbook, ref) {
  const [rawSheetName, rawRange] = ref.split("!");
  if (!rawSheetName || !rawRange) return [];
  const sheetName = rawSheetName.replace(/^'|'$/g, "").replace(/''/g, "'");
  const sheet = workbook.Sheets[sheetName];
  if (!sheet) return [];

  const range = XLSX.utils.decode_range(rawRange.replace(/\$/g, ""));
  const values = [];
  for (let row = range.s.r; row <= range.e.r; row += 1) {
    for (let column = range.s.c; column <= range.e.c; column += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r: row, c: column })];
      if (cell && cleanText(cell.v)) values.push(cleanText(cell.v));
    }
  }
  return values;
}

function validateDropdownValue(value, allowed) {
  if (!allowed || cleanText(value) === "") return value;
  const exact = findAllowed(value, allowed);
  if (exact) return exact;

  const candidates = splitList(value).flatMap((item) => [item, dropdownSynonym(item)]);
  for (const candidate of candidates) {
    const match = findAllowed(candidate, allowed);
    if (match) return match;
  }

  const synonymMatch = findAllowed(dropdownSynonym(value), allowed);
  return synonymMatch || "";
}

function findAllowed(value, allowed) {
  const normalized = normalizeDropdown(value);
  return allowed.find((item) => normalizeDropdown(item) === normalized) ?? "";
}

function dropdownSynonym(value) {
  const synonyms = {
    "hard case": "Hardside",
    zipper: "Zip",
    zippered: "Zip",
    pu: "PU",
    pp: "Polypropylene",
    "synthetic leather": "Synthetic",
    glitter: "Satin",
  };
  return synonyms[normalizeDropdown(value)] ?? cleanText(value);
}

function normalizeDropdown(value) {
  return cleanText(value).toLowerCase().replace(/[\s_-]+/g, " ");
}

function toNisRows(product, imageManifest) {
  const group = product.noonAttributes.product_group ?? {};
  const variants = product.noonAttributes.variants?.length ? product.noonAttributes.variants : fallbackVariants(product.meta, group);
  const [family, productType, productSubtype] = productCategory(group);
  const images = collectImageUrls(product.meta, variants[0]);
  const weightKg = firstValue(variants[0]?.actual_weight_kg, gramsToKg(product.meta.packageInfo?.weightG));

  return variants.map((variant) => {
    const partnerSku = firstValue(variant.partner_sku, product.meta.productId);
    const row = {
      Family: family,
      "Product Type": productType,
      "Product Subtype": productSubtype,
      Brand: firstValue(group.brand, product.meta.attributes?.["品牌"]),
      "Product Title EN": firstValue(variant.title_en, group.product_group_name_en, product.meta.title),
      "Product Title AR": firstValue(variant.title_ar, group.product_group_name_ar),
      "Partner SKU Unique": partnerSku,
      "Style or Part Name": firstValue(group.model_name, variant.subtitle_en, group.product_group_name_en),
      "Model Name": firstValue(group.model_name, variant.subtitle_en, group.product_group_name_en),
      "Style or Part Number": firstValue(variant.model_number, variant.partner_sku, product.meta.productId),
      "Model Number": firstValue(variant.model_number, variant.partner_sku, product.meta.productId),
      "Colour Name": firstValue(variant.colour_name, variant.colour),
      "Colour Name EN": firstValue(variant.colour_name, variant.colour),
      "Colour Family": firstValue(variant.colour_name, variant.colour),
      "Item Condition": group.item_condition,
      Size: group.size,
      "Size Unit": group.size_unit,
      Department: group.gender,
      "Clutch Type": group.type,
      Type: group.type,
      Material: firstValue(group.material_composition, group.exterior_material, translateMaterial(product.meta.attributes?.["材质"])),
      Occasion: group.occasion,
      "Exterior Material": group.exterior_material,
      "Interior Material": group.interior_material,
      Casing: group.casing,
      Closure: group.closure,
      "Closure/Fastener": group.closure,
      "Strap Material": group.strap_material,
      "Handbag Style": "Clutch",
      "Care Instructions": group.care_instructions,
      "Material Composition EN": group.material_composition,
      "Long Description EN": variant.description_en,
      "Long Description AR": variant.description_ar,
      "What's In The Box": group.what_is_in_the_box,
      "What's In The Box EN": group.what_is_in_the_box,
      Year: group.year,
      GTIN: validGtin(variant.barcode),
      "HS Code": group.hs_code,
      "Country of Origin": group.country_of_origin,
      "Product Height": variant.height_cm,
      "Product Height Unit": variant.height_cm === undefined || variant.height_cm === null ? "" : "Centimeter",
      "Product Length": variant.length_cm,
      "Product Length Unit": variant.length_cm === undefined || variant.length_cm === null ? "" : "Centimeter",
      "Product Width": variant.width_cm,
      "Product Width Unit": variant.width_cm === undefined || variant.width_cm === null ? "" : "Centimeter",
      "Product Width/Depth": variant.width_cm,
      "Product Width_Depth Unit": variant.width_cm === undefined || variant.width_cm === null ? "" : "Centimeter",
      "Shipping Weight": weightKg,
      "Shipping Weight Unit": weightKg === "" ? "" : "Kilogram",
      "Product Weight": weightKg,
      "Product Weight Unit": weightKg === "" ? "" : "Kilogram",
      "Recommended Retail Price SA": firstValue(variant.price_sar_initial, product.meta.price),
    };

    fillNumbered(row, "Feature", productFeatures(product.meta, group, variant), 5);
    fillNumbered(row, "Feature Bullet", variant.feature_bullets_en, 12, "EN");
    fillNumbered(row, "Feature Bullet", variant.feature_bullets_ar, 12, "AR");
    const publishedImageUrls = imageUrlsForSku(imageManifest, partnerSku);
    fillNumbered(row, "Image URL", publishedImageUrls.length ? publishedImageUrls : collectImageUrls(product.meta, variant, images), 7);

    return compactRow(row);
  });
}

function positional(values) {
  const optionNames = new Set(["--image-manifest"]);
  return values.filter((value, index) => !optionNames.has(value) && !optionNames.has(values[index - 1]));
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function productCategory(group) {
  const parts = cleanText(group.category).split(">").map(cleanText);
  return [
    parts[0] || "Bags & Luggage",
    parts[1] || "Handbag",
    parts[2] || "Clutch",
  ];
}

function inferProductFeatures(meta, group, variant) {
  const text = normalizeFeatureText([
    meta.title,
    meta.sourceTitle,
    Object.values(meta.attributes ?? {}).join(" "),
    group.product_group_name_en,
    group.features,
    variant.title_en,
    variant.description_en,
    (variant.feature_bullets_en ?? []).join(" "),
  ].join(" "));
  const features = [];

  addFeature(features, "Lightweight", /轻便|小|compact|lightweight|evening|clutch|手拿|晚宴/.test(text));
  addFeature(features, "Detachable Straps", /链条|斜挎|单肩|肩带|strap|crossbody|shoulder|chain/.test(text));
  addFeature(features, "Multi Compartment", /手机袋|内部结构|隔层|口袋|compartment|pocket/.test(text));
  addFeature(features, "Scratch Resistant", /耐磨|防刮|scratch|rhinestone|水钻|镶钻/.test(text));
  addFeature(features, "Wristlet", /手拿|手抓|wristlet|clutch/.test(text));
  addFeature(features, "Waterproof", /防水|waterproof/.test(text));
  addFeature(features, "Foldable", /可折叠|foldable/.test(text));
  addFeature(features, "Expandable", /expandable|可扩展/.test(text));

  return features.slice(0, 5);
}

function productFeatures(meta, group, variant) {
  const configured = Array.isArray(group.features) ? group.features : splitList(group.features);
  const values = configured.map(cleanText).filter(Boolean);
  return values.length ? values.slice(0, 5) : inferProductFeatures(meta, group, variant);
}

function addFeature(features, feature, condition) {
  if (condition && !features.includes(feature)) features.push(feature);
}

function normalizeFeatureText(value) {
  return cleanText(value).toLowerCase();
}

function fallbackVariants(meta, group) {
  const colors = splitList(meta.attributes?.["颜色"]);
  const baseTitle = firstValue(group.product_group_name_en, meta.title);
  const base = colors.length ? colors : [""];

  return base.map((color) => {
    const colorName = translateColor(color);
    const suffix = colorName ? `-${slug(colorName)}` : "";
    return {
      partner_sku: `1688-${meta.productId}${suffix}`,
      title_en: colorName ? `${baseTitle}, ${colorName}` : baseTitle,
      colour: colorName,
      colour_name: colorName,
      actual_weight_kg: gramsToKg(meta.packageInfo?.weightG),
      price_sar_initial: meta.price,
    };
  });
}

function fillNumbered(row, prefix, values = [], limit, suffix = "") {
  values.slice(0, limit).forEach((value, index) => {
    row[`${prefix} ${index + 1}${suffix ? ` ${suffix}` : ""}`] = value;
  });
}

function collectImageUrls(meta, variant, fallback = []) {
  const variantImages = (variant?.images ?? []).map((image) => (typeof image === "string" ? image : image?.url ?? image?.path));
  const urls = [...variantImages, ...(meta.images ?? []), ...fallback].map(cleanText).filter(isUsableNisImageUrl);
  return [...new Set(urls)];
}

function isUsableNisImageUrl(value) {
  if (!/^https?:\/\//i.test(value)) return false;
  if (/\.gif(?:[?#]|$)/i.test(value)) return false;
  if (/alicdn\.com|1688\.com/i.test(value)) return false;
  return true;
}

function splitList(value) {
  return cleanText(value)
    .split(/[,，]/)
    .map(cleanText)
    .filter(Boolean);
}

function translateColor(value) {
  const colors = {
    银色: "Silver",
    黑色: "Black",
    绿色: "Green",
    蓝色: "Blue",
    金色: "Gold",
    红色: "Red",
    玫红色: "Rose Red",
    粉色: "Pink",
    白色: "White",
    紫色: "Purple",
    香槟色: "Champagne",
  };
  return colors[cleanText(value)] ?? cleanText(value);
}

function translateMaterial(value) {
  const materials = {
    涤纶: "Polyester",
  };
  return materials[cleanText(value)] ?? cleanText(value);
}

function slug(value) {
  return cleanText(value).toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function gramsToKg(value) {
  const grams = Number.parseFloat(cleanText(value).replace(/,/g, ""));
  if (!Number.isFinite(grams)) return "";
  return grams / 1000;
}

function validGtin(value) {
  const digits = cleanText(value).replace(/\D/g, "");
  if (![8, 12, 13, 14].includes(digits.length)) return "";

  let sum = 0;
  for (let index = digits.length - 2, weight = 3; index >= 0; index -= 1, weight = weight === 3 ? 1 : 3) {
    sum += Number(digits[index]) * weight;
  }
  const checkDigit = (10 - (sum % 10)) % 10;
  return checkDigit === Number(digits.at(-1)) ? digits : "";
}

function compactRow(row) {
  return Object.fromEntries(Object.entries(row).filter(([, value]) => cleanText(value) !== ""));
}

function firstValue(...values) {
  return values.find((value) => cleanText(value) !== "") ?? "";
}

function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
}

async function writeTemplateCopy(templateFile, outputFile, sheetName, startRowIndex, columnCount, dataRows) {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-xlsx-"));

  try {
    await run("unzip", ["-q", templateFile, "-d", tempDir]);
    const sheetXmlPath = await findWorksheetPath(tempDir, sheetName);
    const xml = await readFile(sheetXmlPath, "utf8");
    await writeFile(sheetXmlPath, patchWorksheetXml(xml, startRowIndex, columnCount, dataRows), "utf8");
    await rm(outputFile, { force: true });
    await run("zip", ["-qr", outputFile, "."], { cwd: tempDir });
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
}

async function findWorksheetPath(unpackedDir, sheetName) {
  const workbookXml = await readFile(path.join(unpackedDir, "xl", "workbook.xml"), "utf8");
  const relsXml = await readFile(path.join(unpackedDir, "xl", "_rels", "workbook.xml.rels"), "utf8");
  const sheetMatch = workbookXml.match(new RegExp(`<sheet\\b[^>]*name="${escapeRegExp(escapeXmlAttribute(sheetName))}"[^>]*\\br:id="([^"]+)"[^>]*/>`));
  if (!sheetMatch) throw new Error(`Could not find sheet ${sheetName}.`);

  const relMatch = relsXml.match(new RegExp(`<Relationship\\b[^>]*Id="${escapeRegExp(sheetMatch[1])}"[^>]*Target="([^"]+)"[^>]*/>`));
  if (!relMatch) throw new Error(`Could not find workbook relationship ${sheetMatch[1]}.`);

  const target = relMatch[1].replace(/^\/+/, "");
  return path.join(unpackedDir, target.startsWith("xl/") ? target : path.join("xl", target));
}

function patchWorksheetXml(xml, startRowIndex, columnCount, dataRows) {
  const startRow = startRowIndex + 1;
  const lastRow = startRow + dataRows.length - 1;
  const lastColumn = columnName(columnCount - 1);
  const rowsXml = dataRows.map((rowValues, rowOffset) => buildRowXml(startRow + rowOffset, rowValues)).join("");
  const patchedSheetData = xml.replace(/<sheetData>[\s\S]*?<\/sheetData>/, (sheetData) => {
    const keptRows = [...sheetData.matchAll(/<row\b[^>]*\br="(\d+)"[^>]*>[\s\S]*?<\/row>/g)]
      .filter((match) => Number(match[1]) < startRow)
      .map((match) => match[0])
      .join("");
    return `<sheetData>${keptRows}${rowsXml}</sheetData>`;
  });

  return patchedSheetData.replace(/<dimension\b[^>]*\/>/, `<dimension ref="A1:${lastColumn}${lastRow}"/>`);
}

function buildRowXml(rowNumber, rowValues) {
  const cells = rowValues
    .map((value, column) => buildCellXml(rowNumber, column, value))
    .filter(Boolean)
    .join("");
  return `<row r="${rowNumber}" spans="1:${rowValues.length}">${cells}</row>`;
}

function buildCellXml(rowNumber, column, value) {
  if (cleanText(value) === "") return "";
  const cellRef = `${columnName(column)}${rowNumber}`;
  if (typeof value === "number") return `<c r="${cellRef}"><v>${value}</v></c>`;
  return `<c r="${cellRef}" t="inlineStr"><is><t>${escapeXmlText(value)}</t></is></c>`;
}

function columnName(index) {
  let column = "";
  let value = index + 1;
  while (value > 0) {
    const remainder = (value - 1) % 26;
    column = String.fromCharCode(65 + remainder) + column;
    value = Math.floor((value - 1) / 26);
  }
  return column;
}

function escapeXmlText(value) {
  return cleanText(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function escapeXmlAttribute(value) {
  return escapeXmlText(value).replace(/"/g, "&quot;");
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
