import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import { normalizeNoonStoreId } from "./noon-stores.js";

export const noonUploadStatusFileName = "noon-upload-status.json";
const validStatuses = new Set(["not_uploaded", "uploading", "uploaded", "failed"]);

export function defaultNoonUploadStatus(productDir = "") {
  return {
    productDir,
    status: "not_uploaded",
    uploaded: false,
    uploadedAt: "",
    partnerSku: "",
    partnerSkus: [],
    message: "尚未上传到 noon。",
  };
}

export function normalizeStoreId(storeId = "") {
  return normalizeNoonStoreId(storeId || "default");
}

export function readStoreNoonUploadStatusFromProductDir(productDir, relativeDir = "", storeId = "default") {
  const raw = readRawStatus(productDir);
  if (!raw) return defaultNoonUploadStatus(relativeDir);
  if (raw.statusUnreadable) return unreadableStatus(relativeDir);
  if (raw.version !== 2 || !raw.stores || typeof raw.stores !== "object") return defaultNoonUploadStatus(relativeDir);

  const id = normalizeStoreId(storeId);
  return normalizeNoonUploadStatus(raw.stores[id], relativeDir);
}

export async function writeStoreNoonUploadStatus(productDir, status, storeId = "default") {
  const raw = readRawStatus(productDir);
  const stores = raw && !raw.statusUnreadable && raw.version === 2 && raw.stores && typeof raw.stores === "object" ? raw.stores : {};
  const id = normalizeStoreId(storeId);
  const previous = normalizeNoonUploadStatus(stores[id], status.productDir || "");
  const nextStatus = normalizeNoonUploadStatus(status, status.productDir || "", previous);
  const next = {
    version: 2,
    stores: {
      ...stores,
      [id]: nextStatus,
    },
  };

  await writeFile(path.join(productDir, noonUploadStatusFileName), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next.stores[id];
}

function readRawStatus(productDir) {
  const statusPath = path.join(productDir, noonUploadStatusFileName);
  if (!existsSync(statusPath)) return null;

  try {
    return JSON.parse(readFileSync(statusPath, "utf8"));
  } catch {
    return { statusUnreadable: true };
  }
}

function unreadableStatus(relativeDir) {
  return {
    ...defaultNoonUploadStatus(relativeDir),
    status: "status_unreadable",
    message: "noon 上传状态文件不可读取。",
  };
}

function normalizeNoonUploadStatus(status, relativeDir, previous = defaultNoonUploadStatus(relativeDir)) {
  const state = validStatuses.has(status?.status) ? status.status : "not_uploaded";
  const uploaded = state === "uploaded";
  const partnerSku = String(status?.partnerSku || "").trim();
  const partnerSkus = [
    ...new Set([
      ...(Array.isArray(previous?.partnerSkus) ? previous.partnerSkus : []),
      ...(Array.isArray(status?.partnerSkus) ? status.partnerSkus : []),
      ...(uploaded && partnerSku ? [partnerSku] : []),
    ].map((sku) => String(sku || "").trim()).filter(Boolean)),
  ];
  return {
    productDir: String(status?.productDir || relativeDir || ""),
    status: state,
    uploaded,
    uploadedAt: uploaded ? String(status?.uploadedAt || "") : "",
    partnerSku,
    partnerSkus,
    message: String(status?.message || (uploaded ? "已上传到 noon。" : "尚未上传到 noon。")),
  };
}
