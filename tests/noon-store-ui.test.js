import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("store management controls and API calls are present", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  for (const id of ["storeSearch", "storeList", "addStoreButton", "storeDialog", "uploadStoreId"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /fetchJson\("\/api\/stores"\)/);
  assert.match(html, /\/api\/stores\/.*\/login/);
  assert.match(html, /storeId:\s*uploadStoreId\.value/);
  assert.doesNotMatch(html, /id=["']noonUrl["']/);
  assert.doesNotMatch(html, /id=["']defaultStoreId["']/);
});

test("settings page separates collection, store, upload, and operations settings", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  for (const section of ["collect-environment", "upload-settings", "operations-settings"]) {
    assert.match(html, new RegExp(`data-settings-section=["']${section}["']`));
  }

  for (const title of ["1688 采集环境", "Noon 上传设置", "运营参数"]) {
    assert.match(html, new RegExp(title));
  }

  assert.match(html, />上传目标店铺</);
  assert.doesNotMatch(html, /data-settings-section=["']store-management["']/);
  assert.doesNotMatch(html, /noon \/ AI 配置/);
});

test("store management lives on a dedicated stores page", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /data-route=["']stores["']/);
  assert.match(html, /data-page=["']stores["']/);

  const storesPage = html.match(/<section class=["']page["'] data-page=["']stores["']>([\s\S]*?)<\/section>\s*<section class=["']page["'] data-page=["']settings["']>/);
  assert.ok(storesPage, "stores page should be defined before settings page");

  for (const id of ["storeSearch", "storeList", "addStoreButton", "noonStatus", "checkNoonButton"]) {
    assert.match(storesPage[1], new RegExp(`id=["']${id}["']`));
  }

  const settingsPage = html.match(/<section class=["']page["'] data-page=["']settings["']>([\s\S]*?)<\/section>\s*<\/section>\s*<div class=["']dialog-backdrop["'] id=["']repositoryDialog["']/);
  assert.ok(settingsPage, "settings page should be defined before dialogs");

  for (const id of ["storeSearch", "storeList", "addStoreButton", "noonStatus", "checkNoonButton"]) {
    assert.doesNotMatch(settingsPage[1], new RegExp(`id=["']${id}["']`));
  }
});

test("store status messages wrap long browser errors", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /\.status-strip span\s*\{[\s\S]*overflow-wrap:\s*anywhere/);
});
