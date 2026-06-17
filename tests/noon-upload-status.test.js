import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultNoonUploadStatus,
  noonUploadStatusFileName,
  readNoonUploadStatusFromProductDir,
  writeNoonUploadStatus,
} from "../scripts/lib/noon-upload-status.js";

test("noon upload status defaults to not uploaded when no status file exists", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });

  assert.deepEqual(readNoonUploadStatusFromProductDir(productDir, "1688/repo/1001"), {
    ...defaultNoonUploadStatus("1688/repo/1001"),
  });
});

test("noon upload status records successful product uploads", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });

  await writeNoonUploadStatus(productDir, {
    productDir: "1688/repo/1001",
    status: "uploaded",
    uploaded: true,
    uploadedAt: "2026-06-15T00:00:00.000Z",
    partnerSku: "SBS-CLUTCH-002",
    message: "Add Product 上传成功，已提交 Offer Details。",
  });

  assert.deepEqual(readNoonUploadStatusFromProductDir(productDir, "1688/repo/1001"), {
    productDir: "1688/repo/1001",
    status: "uploaded",
    uploaded: true,
    uploadedAt: "2026-06-15T00:00:00.000Z",
    partnerSku: "SBS-CLUTCH-002",
    message: "Add Product 上传成功，已提交 Offer Details。",
  });
});

test("noon upload status reports unreadable status files", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });
  await writeFile(path.join(productDir, noonUploadStatusFileName), "{", "utf8");

  assert.deepEqual(readNoonUploadStatusFromProductDir(productDir, "1688/repo/1001"), {
    ...defaultNoonUploadStatus("1688/repo/1001"),
    status: "status_unreadable",
    message: "noon 上传状态文件不可读取。",
  });
});
