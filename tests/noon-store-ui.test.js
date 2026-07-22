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

test("variant details can load variants from noon attributes when summary is stale", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /await loadProductVariants\(product\)/);
  assert.match(html, /fetchJson\(product\.noonUrl\)/);
  assert.match(html, /normalizeNoonVariant/);
});

test("repositories page has a wide product workspace and a separate detail page", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /class=["']product-page-shell["']/);
  assert.match(html, /id=["']productPageRoot["']/);
  assert.match(html, /\.repository-controls\s*\{[\s\S]*grid-template-columns:\s*minmax\(360px,\s*1fr\) auto/);
  assert.match(html, /data-page=["']product-detail["']/);
  assert.match(html, /id=["']productDetailBody["']/);
  assert.doesNotMatch(html, /openRepositoryDialog\(repository\)/);
  assert.doesNotMatch(html, /className = "repository-detail-panel"/);
});

test("repositories page loads summaries and product pages separately", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /\/api\/repositories/);
  assert.match(html, /async function loadRepositoryProductPage/);
  assert.match(html, /\/api\/products\?\$\{productParams\}/);
  assert.match(html, /productPageState/);
  assert.doesNotMatch(html, /fetchJson\(params\.toString\(\) \? `\/api\/products\?\$\{params\}` : "\/api\/products"\)/);
});

test("repository upload sends repository id instead of current page product dirs", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /startUploadJob\(\{\s*repository:\s*repository\.id/);
  assert.doesNotMatch(html, /startUploadJob\(\{\s*productDirs:\s*products\.map/);
});

test("product detail page uses grouped SKU variant table layout", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");

  assert.match(html, /class=["']detail-toolbar-primary["']/);
  assert.match(html, /class=["'][^"']*detail-sku-card/);
  assert.match(html, /function groupDetailVariants/);
  assert.match(html, /class=["']variant-group-card["']/);
  assert.match(html, /class=["']variant-group-table["']/);
  assert.match(html, />成本价</);
  assert.match(html, />SKU变体/);
  assert.match(html, />建议售价/);
  assert.match(html, />促销价/);
});

test("product detail page reuses shared app typography and radius tokens", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  const detailCss = html.match(/\.product-detail-body\s*\{[\s\S]*?\.empty,\s*\n\s*\.notice\s*\{/);
  assert.ok(detailCss, "detail CSS block should be present");

  assert.match(detailCss[0], /\.detail-title-line h2\s*\{[\s\S]*font-size:\s*var\(--text-xl\)/);
  assert.match(detailCss[0], /\.detail-editor-title h3\s*\{[\s\S]*font-size:\s*var\(--text-md\)/);
  assert.match(detailCss[0], /\.variant-group-table td\s*\{[\s\S]*font-weight:\s*700/);
  assert.doesNotMatch(detailCss[0], /border-radius:\s*14px/);
  assert.doesNotMatch(detailCss[0], /border-radius:\s*10px/);
});
