import { open, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { deriveStorePartnerSku } from "./noon-product-identity.js";
import { normalizeNoonStoreId } from "./noon-stores.js";
import { noonUploadStatusFileName, readStoreNoonUploadStatusFromProductDir } from "./noon-upload-status.js";
import { readProductDirs } from "./product-storage.js";

const noonAttributesFileName = "noon-product-attributes.json";

export function scopeProductToStore(product, storeId) {
  const scoped = structuredClone(product);
  const baseSku = readBaseSku(scoped);
  const storeSku = deriveStorePartnerSku(baseSku, storeId);

  if (!scoped?.productIdentity || !scoped?.detailedContent || !scoped?.offerDetails?.offers?.[0]) {
    throw new Error("商品缺少店铺上传所需的标准化字段。");
  }

  scoped.productIdentity.partnerSku = storeSku;
  scoped.detailedContent.modelNumber = storeSku;
  scoped.offerDetails.offers[0].partnerSku = storeSku;
  return scoped;
}

export async function assertStoreUploadAllowed({ productDir, relativeDir, storeId, product, productsDir }) {
  const normalizedStoreId = normalizeNoonStoreId(storeId);
  const baseSku = readBaseSku(product);
  const storeSku = deriveStorePartnerSku(baseSku, normalizedStoreId);
  const barcode = String(product?.offerDetails?.offers?.[0]?.barcode || "").trim();
  const status = readStoreNoonUploadStatusFromProductDir(productDir, relativeDir, normalizedStoreId);

  if (status.status === "uploaded" && hasUploadedPartnerSku(status, storeSku)) {
    throw new Error(`商品 ${relativeDir} 在店铺 ${normalizedStoreId} 已经上传。`);
  }
  if (status.status === "uploading") {
    throw new Error(`商品 ${relativeDir} 在店铺 ${normalizedStoreId} 正在上传。`);
  }

  const scan = await scanUploadIdentity(productsDir, normalizedStoreId);
  const issues = [];
  collectDuplicate(issues, "重复基础 SKU", baseSku, withCurrentPath(scan.baseSkuPaths.get(baseSku), relativeDir));
  collectDuplicate(issues, "重复店铺 SKU", storeSku, withCurrentPath(scan.storeSkuPaths.get(storeSku), relativeDir));
  if (barcode) {
    collectDuplicate(issues, "重复条码", barcode, withCurrentPath(scan.barcodePaths.get(barcode), relativeDir));
  }
  if (issues.length > 0) {
    throw new Error(issues.join("\n"));
  }
}

export async function acquireStoreUploadLock(productDir, storeId, partnerSku) {
  const normalizedStoreId = normalizeNoonStoreId(storeId);
  const lockPath = path.join(productDir, `.noon-upload-lock-${normalizedStoreId}.json`);
  let handle;

  try {
    handle = await open(lockPath, "wx");
  } catch (error) {
    if (error?.code === "EEXIST") {
      throw new Error(`商品在店铺 ${normalizedStoreId} 正在上传，锁文件已存在。`);
    }
    throw error;
  }

  try {
    await handle.writeFile(
      `${JSON.stringify(
        {
          storeId: normalizedStoreId,
          partnerSku: String(partnerSku || "").trim(),
          pid: process.pid,
          createdAt: new Date().toISOString(),
        },
        null,
        2,
      )}\n`,
      "utf8",
    );
  } catch (error) {
    await safeClose(handle);
    await safeRemove(lockPath);
    throw error;
  }

  let released = false;
  return {
    async release() {
      if (released) return;
      released = true;
      await safeClose(handle);
      await safeRemove(lockPath);
    },
  };
}

function readBaseSku(product) {
  const sku = String(product?.productIdentity?.partnerSku || product?.offerDetails?.offers?.[0]?.partnerSku || "").trim();
  if (!sku) throw new Error("商品缺少基础 Partner SKU。");
  return sku;
}

async function scanUploadIdentity(productsDir, storeId) {
  const productDirs = await readProductDirs(productsDir);
  const baseSkuPaths = new Map();
  const storeSkuPaths = new Map();
  const barcodePaths = new Map();

  for (const entry of productDirs) {
    const noonAttributesPath = path.join(entry.fullPath, noonAttributesFileName);
    let noonAttributes = null;

    try {
      noonAttributes = JSON.parse(await readFile(noonAttributesPath, "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw new Error(`无法读取 ${noonAttributesFileName}: ${entry.relativeDir}。`);
      }
    }

    if (noonAttributes) {
      for (const variant of Array.isArray(noonAttributes.variants) ? noonAttributes.variants : []) {
        const baseSku = String(variant?.partner_sku || variant?.partnerSku || "").trim();
        const barcode = String(variant?.barcode || "").trim();
        if (baseSku) {
          appendPath(baseSkuPaths, baseSku, entry.relativeDir);
          appendPath(storeSkuPaths, deriveStorePartnerSku(baseSku, storeId), entry.relativeDir);
        }
        if (barcode) {
          appendPath(barcodePaths, barcode, entry.relativeDir);
        }
      }
    }

    const storeStatus = readStoreNoonUploadStatusFromProductDir(entry.fullPath, entry.relativeDir, storeId);
    if (storeStatus.status === "status_unreadable") {
      throw new Error(`无法读取 ${noonUploadStatusFileName}: ${entry.relativeDir}。`);
    }
    if (storeStatus.status === "uploaded" || storeStatus.status === "uploading") {
      for (const partnerSku of storeStatusPartnerSkus(storeStatus)) {
        appendPath(storeSkuPaths, partnerSku, entry.relativeDir);
      }
    }
  }

  return { baseSkuPaths, storeSkuPaths, barcodePaths };
}

function hasUploadedPartnerSku(status, partnerSku) {
  return storeStatusPartnerSkus(status).includes(String(partnerSku || "").trim());
}

function storeStatusPartnerSkus(status) {
  return [
    ...new Set([
      ...(Array.isArray(status?.partnerSkus) ? status.partnerSkus : []),
      status?.partnerSku,
    ].map((sku) => String(sku || "").trim()).filter(Boolean)),
  ];
}

function appendPath(map, key, relativeDir) {
  const existing = map.get(key);
  if (existing) {
    existing.add(relativeDir);
    return;
  }
  map.set(key, new Set([relativeDir]));
}

function withCurrentPath(paths, currentPath) {
  const next = new Set(paths || []);
  if (currentPath) next.add(currentPath);
  return [...next].sort((left, right) => left.localeCompare(right));
}

function collectDuplicate(issues, label, value, paths) {
  if (!value || paths.length < 2) return;
  issues.push(`${label}: ${value} -> ${paths.join(", ")}`);
}

async function safeClose(handle) {
  try {
    await handle.close();
  } catch {}
}

async function safeRemove(filePath) {
  try {
    await rm(filePath, { force: true });
  } catch {}
}
