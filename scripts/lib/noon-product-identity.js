import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeNoonStoreId } from "./noon-stores.js";

const barcodeBodyModulo = 100000000000n;

export function buildBasePartnerSku({ productId, variantIndex = 0, colourCode = "" } = {}) {
  const product = String(productId || "").trim();
  if (!product) throw new Error("Missing productId.");
  const variantNumber = normalizeVariantIndex(variantIndex) + 1;
  return `G-1001-${product}-V${String(variantNumber).padStart(2, "0")}-${normalizeColourCode(colourCode)}`;
}

export function deriveStorePartnerSku(baseSku, storeId) {
  const sku = String(baseSku || "").trim();
  if (!sku) throw new Error("Missing baseSku.");
  return `${sku}-${normalizeNoonStoreId(storeId)}`;
}

export function buildPartnerBarcode({ platform = "", productId = "", variantIndex = 0, occupied = new Set() } = {}) {
  const product = String(productId || "").trim();
  const sourcePlatform = String(platform || "").trim();
  if (!sourcePlatform) throw new Error("Missing platform.");
  if (!product) throw new Error("Missing productId.");

  let body = barcodeSeed({ platform: sourcePlatform, productId: product, variantIndex: normalizeVariantIndex(variantIndex) });

  while (true) {
    const bodyText = formatBarcodeBody(body);
    const barcode = `${bodyText}${upcCheckDigit(bodyText)}`;
    if (!occupied.has(barcode)) return barcode;
    body = (body + 1n) % barcodeBodyModulo;
  }
}

export async function regenerateProductIdentities(productsDir) {
  const productDirs = (await read1688ProductDirs(productsDir)).sort((left, right) =>
    left.relativeDir.localeCompare(right.relativeDir),
  );
  const occupied = new Set();
  const changedProducts = [];
  const skippedProducts = [];

  for (const productDir of productDirs) {
    const filePath = path.join(productDir.fullPath, "noon-product-attributes.json");
    const metaPath = path.join(productDir.fullPath, "meta.json");
    let product;
    let productId = path.basename(productDir.fullPath);

    try {
      product = await readJson(filePath);
    } catch (error) {
      skippedProducts.push({
        productDir: productDir.relativeDir,
        reason: formatSkipReason(error),
      });
      continue;
    }

    try {
      const meta = await readJson(metaPath);
      productId = String(meta?.source?.productId || productId).trim() || productId;
    } catch {}

    const variants = Array.isArray(product?.variants) ? product.variants : [];
    let changed = false;

    for (const [variantIndex, variant] of variants.entries()) {
      const partnerSku = buildBasePartnerSku({
        productId,
        variantIndex,
        colourCode: String(variant?.colour_name || variant?.colour || "").trim(),
      });
      const barcode = buildPartnerBarcode({
        platform: "1688",
        productId,
        variantIndex,
        occupied,
      });
      occupied.add(barcode);
      if (String(variant?.partner_sku || "").trim() !== partnerSku) {
        variant.partner_sku = partnerSku;
        changed = true;
      }
      if (String(variant?.model_number || "").trim() !== partnerSku) {
        variant.model_number = partnerSku;
        changed = true;
      }
      if (String(variant?.barcode || "").trim() !== barcode) {
        variant.barcode = barcode;
        changed = true;
      }
    }

    if (!changed) continue;
    changedProducts.push(productDir.relativeDir);
    await writeFile(filePath, `${JSON.stringify(product, null, 2)}\n`, "utf8");
  }

  return { changedProducts, skippedProducts };
}

export function upcCheckDigit(body) {
  if (!/^[0-9]{11}$/.test(body)) throw new Error("Barcode body must contain 11 digits.");
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}

function normalizeVariantIndex(value) {
  const index = Number.parseInt(String(value), 10);
  if (!Number.isInteger(index) || index < 0) throw new Error("variantIndex must be a non-negative integer.");
  return index;
}

function normalizeColourCode(value) {
  const normalized = String(value || "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 12);

  return normalized || "COLOUR";
}

function barcodeSeed({ platform, productId, variantIndex }) {
  const digest = createHash("sha256").update(`${platform}:${productId}:${variantIndex}`).digest("hex");
  return BigInt(`0x${digest}`) % barcodeBodyModulo;
}

function formatBarcodeBody(value) {
  return value.toString().padStart(11, "0");
}

async function readJson(filePath) {
  return JSON.parse(await readFile(filePath, "utf8"));
}

function formatSkipReason(error) {
  if (error instanceof Error && error.message) return error.message;
  return String(error);
}

async function read1688ProductDirs(productsDir) {
  const platformDir = path.join(productsDir, "1688");
  const productDirs = [];

  for (const repositoryEntry of await readDirectory(platformDir)) {
    if (!repositoryEntry.isDirectory()) continue;
    const repositoryDir = path.join(platformDir, repositoryEntry.name);

    for (const productEntry of await readDirectory(repositoryDir)) {
      if (!productEntry.isDirectory()) continue;
      productDirs.push({
        relativeDir: `1688/${repositoryEntry.name}/${productEntry.name}`,
        fullPath: path.join(repositoryDir, productEntry.name),
      });
    }
  }

  return productDirs;
}

async function readDirectory(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}
