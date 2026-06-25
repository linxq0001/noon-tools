import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  defaultNoonUploadStatus,
  normalizeStoreId,
  noonUploadStatusFileName,
  readStoreNoonUploadStatusFromProductDir,
  writeStoreNoonUploadStatus,
} from "../scripts/lib/noon-upload-status.js";

async function makeProductDir() {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-upload-status-"));
  const productDir = path.join(root, "1688", "repo", "1001");
  await mkdir(productDir, { recursive: true });
  return productDir;
}

test("store upload status defaults to not uploaded when no status file exists", async () => {
  const productDir = await makeProductDir();

  assert.deepEqual(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "UAE01"), {
    ...defaultNoonUploadStatus("1688/repo/1001"),
  });
});

test("ignores unreadable status files", async () => {
  const productDir = await makeProductDir();
  await writeFile(path.join(productDir, noonUploadStatusFileName), "{", "utf8");

  assert.deepEqual(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "UAE01"), {
    ...defaultNoonUploadStatus("1688/repo/1001"),
    status: "status_unreadable",
    message: "noon 上传状态文件不可读取。",
  });
});

test("ignores legacy top-level upload status", async () => {
  const productDir = await makeProductDir();
  await writeFile(
    path.join(productDir, noonUploadStatusFileName),
    JSON.stringify({
      status: "uploaded",
      uploaded: true,
      partnerSku: "OLD-SKU",
    }),
    "utf8",
  );

  assert.deepEqual(readStoreNoonUploadStatusFromProductDir(productDir, "1688/default/1", "UAE01"), {
    ...defaultNoonUploadStatus("1688/default/1"),
  });
});

test("store scoped upload status records separate stores", async () => {
  const productDir = await makeProductDir();

  await writeStoreNoonUploadStatus(
    productDir,
    {
      productDir: "1688/repo/1001",
      status: "uploaded",
      uploadedAt: "2026-06-18T00:00:00.000Z",
      partnerSku: "SBS-CLUTCH-002",
      message: "UAE 店铺上传成功。",
    },
    "UAE01",
  );

  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "UAE01").uploaded, true);
  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/repo/1001", "SA01").uploaded, false);
});

test("writes only version 2 store state", async () => {
  const productDir = await makeProductDir();

  await writeStoreNoonUploadStatus(
    productDir,
    {
      status: "uploading",
      partnerSku: "G-1001-1-V01-UAE01",
      message: "正在上传。",
    },
    "UAE01",
  );

  const raw = JSON.parse(await readFile(path.join(productDir, noonUploadStatusFileName), "utf8"));
  assert.deepEqual(Object.keys(raw).sort(), ["stores", "version"]);
  assert.equal(raw.version, 2);
  assert.equal(raw.stores.UAE01.status, "uploading");
  assert.equal(raw.stores.UAE01.uploaded, false);
});

test("writeStoreNoonUploadStatus overwrites with only version and stores", async () => {
  const productDir = await makeProductDir();
  await writeFile(
    path.join(productDir, noonUploadStatusFileName),
    JSON.stringify({
      version: 2,
      stores: {
        SA01: {
          productDir: "1688/repo/1001",
          status: "uploaded",
          uploaded: true,
          uploadedAt: "2026-06-18T00:00:00.000Z",
          partnerSku: "SA-SKU",
          message: "done",
        },
      },
      note: "drop-me",
      status: "uploaded",
      partnerSku: "OLD-SKU",
    }),
    "utf8",
  );

  await writeStoreNoonUploadStatus(
    productDir,
    {
      productDir: "1688/repo/1001",
      status: "uploading",
      partnerSku: "NEW-SKU",
      message: "new",
    },
    "UAE01",
  );

  const raw = JSON.parse(await readFile(path.join(productDir, noonUploadStatusFileName), "utf8"));
  assert.deepEqual(Object.keys(raw).sort(), ["stores", "version"]);
  assert.equal(raw.stores.SA01.partnerSku, "SA-SKU");
  assert.equal(raw.stores.UAE01.partnerSku, "NEW-SKU");
});

test("normalizeStoreId keeps safe manual store IDs", () => {
  assert.equal(normalizeStoreId("UAE01"), "UAE01");
  assert.equal(normalizeStoreId("  uae01 "), "UAE01");
  assert.throws(() => normalizeStoreId("../bad"), /店铺 ID/);
});

test("upload-noon source uses store scoped status writer and requires store id", async () => {
  const source = await readFile(path.join(process.cwd(), "scripts", "upload-noon.js"), "utf8");

  assert.match(source, /import\s+\{\s*writeStoreNoonUploadStatus\s*\}\s+from\s+"\.\/lib\/noon-upload-status\.js"/);
  assert.doesNotMatch(source, /writeNoonUploadStatus/);
  assert.match(source, /Missing --store-id <id>\./);
  assert.match(source, /normalizeNoonStoreId\(args\.storeId\)/);
  assert.match(source, /writeStoreNoonUploadStatus\(product\.productDir,/);
});

test("server source uses latest-only upload status reader contract", async () => {
  const source = await readFile(path.join(process.cwd(), "scripts", "server.js"), "utf8");

  assert.match(source, /defaultNoonUploadStatus/);
  assert.match(source, /readStoreNoonUploadStatusFromProductDir/);
  assert.doesNotMatch(source, /readNoonUploadStatusFromProductDir/);
  assert.match(source, /\?\s*readStoreNoonUploadStatusFromProductDir\(/);
  assert.match(source, /:\s*defaultNoonUploadStatus\(relativeDir\)/);
});
