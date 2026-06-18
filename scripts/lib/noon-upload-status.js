import { existsSync, readFileSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import path from "node:path";

export const noonUploadStatusFileName = "noon-upload-status.json";

export function defaultNoonUploadStatus(productDir = "") {
  return {
    productDir,
    status: "not_uploaded",
    uploaded: false,
    uploadedAt: "",
    partnerSku: "",
    message: "尚未上传到 noon。",
  };
}

export function normalizeStoreId(storeId = "") {
  const raw = String(storeId || "default").trim();
  if (raw.includes("..") || raw.includes("/") || raw.includes("\\")) throw new Error("Invalid store ID");

  const normalized = raw.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "");
  if (!normalized) throw new Error("Invalid store ID");
  return normalized;
}

export function readNoonUploadStatusFromProductDir(productDir, relativeDir = "") {
  const raw = readRawStatus(productDir);
  if (!raw) return defaultNoonUploadStatus(relativeDir);
  if (raw.statusUnreadable) return unreadableStatus(relativeDir);

  return normalizeNoonUploadStatus(raw, relativeDir);
}

export function readStoreNoonUploadStatusFromProductDir(productDir, relativeDir = "", storeId = "default") {
  const raw = readRawStatus(productDir);
  if (!raw) return defaultNoonUploadStatus(relativeDir);
  if (raw.statusUnreadable) return unreadableStatus(relativeDir);

  const id = normalizeStoreId(storeId);
  return normalizeNoonUploadStatus(raw.stores?.[id] || {}, relativeDir);
}

export async function writeNoonUploadStatus(productDir, status) {
  const raw = readRawStatus(productDir);
  const base = raw && !raw.statusUnreadable ? raw : {};
  const next = {
    ...base,
    ...normalizeNoonUploadStatus(status, status.productDir || ""),
  };
  await writeFile(path.join(productDir, noonUploadStatusFileName), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

export async function writeStoreNoonUploadStatus(productDir, status, storeId = "default") {
  const raw = readRawStatus(productDir);
  const base = raw && !raw.statusUnreadable ? raw : {};
  const id = normalizeStoreId(storeId);
  const next = {
    ...base,
    stores: {
      ...(base.stores || {}),
      [id]: normalizeNoonUploadStatus(status, status.productDir || ""),
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

function normalizeNoonUploadStatus(status, relativeDir) {
  const uploaded = Boolean(status.uploaded) || status.status === "uploaded";
  return {
    productDir: String(status.productDir || relativeDir || ""),
    status: uploaded ? "uploaded" : String(status.status || "not_uploaded"),
    uploaded,
    uploadedAt: String(status.uploadedAt || ""),
    partnerSku: String(status.partnerSku || status.noonSku || ""),
    message: String(status.message || (uploaded ? "已上传到 noon。" : "尚未上传到 noon。")),
  };
}
