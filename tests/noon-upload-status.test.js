import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultNoonUploadStatus,
  normalizeStoreId,
  noonUploadStatusFileName,
  readNoonUploadStatusFromProductDir,
  readStoreNoonUploadStatusFromProductDir,
  writeStoreNoonUploadStatus,
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

test("store scoped upload status records separate stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-store-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });

  await writeStoreNoonUploadStatus(
    productDir,
    {
      productDir: "1688/repo/1001",
      status: "uploaded",
      uploaded: true,
      uploadedAt: "2026-06-18T00:00:00.000Z",
      partnerSku: "SBS-CLUTCH-002",
      message: "UAE 店铺上传成功。",
    },
    "noon-uae-main",
  );

  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "noon-uae-main").uploaded, true);
  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "noon-sa-second").uploaded, false);
});

test("top-level upload status preserves existing store scoped statuses", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-preserve-store-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });

  await writeStoreNoonUploadStatus(productDir, { productDir: "1688/repo/1001", status: "uploaded", uploaded: true }, "noon-uae-main");
  await writeNoonUploadStatus(productDir, { productDir: "1688/repo/1001", status: "uploaded", uploaded: true });

  assert.equal(readNoonUploadStatusFromProductDir(productDir, "1688/repo/1001").uploaded, true);
  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "noon-uae-main").uploaded, true);
});

test("normalizeStoreId keeps safe manual store IDs", () => {
  assert.equal(normalizeStoreId("noon-uae-main"), "noon-uae-main");
  assert.equal(normalizeStoreId(" Noon UAE Main "), "noon-uae-main");
  assert.throws(() => normalizeStoreId("../bad"), /Invalid store ID/);
});
