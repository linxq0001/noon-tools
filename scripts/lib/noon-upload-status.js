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

export function readNoonUploadStatusFromProductDir(productDir, relativeDir = "") {
  const statusPath = path.join(productDir, noonUploadStatusFileName);
  if (!existsSync(statusPath)) return defaultNoonUploadStatus(relativeDir);

  try {
    const raw = JSON.parse(readFileSync(statusPath, "utf8"));
    return normalizeNoonUploadStatus(raw, relativeDir);
  } catch {
    return {
      ...defaultNoonUploadStatus(relativeDir),
      status: "status_unreadable",
      message: "noon 上传状态文件不可读取。",
    };
  }
}

export async function writeNoonUploadStatus(productDir, status) {
  const next = normalizeNoonUploadStatus(status, status.productDir || "");
  await writeFile(path.join(productDir, noonUploadStatusFileName), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
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
