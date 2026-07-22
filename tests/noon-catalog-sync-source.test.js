import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertNoonCatalogUrl,
  findNoonStoreCode,
} from "../scripts/sync-noon-catalog-internal-api.js";

const source = readFileSync(new URL("../scripts/sync-noon-catalog.js", import.meta.url), "utf8");

test("noon catalog sync walks catalog pagination instead of only reading the first page", () => {
  assert.match(source, /async function collectCatalogRows\(page\)/);
  assert.match(source, /async function clickCatalogNextPage\(page, pageNumber\)/);
  assert.match(source, /async function gotoCatalogPage\(page, pageNumber, previousSignature\)/);
  assert.match(source, /正在同步第 \$\{pageNumber\}/);
  assert.doesNotMatch(source, /\.slice\(0,\s*200\)/);
});

test("noon catalog sync captures image URLs with row cells", () => {
  assert.match(source, /const image = row\.querySelector\("img"\)/);
  assert.match(source, /const imageUrl = image\?\.currentSrc \|\| image\?\.src \|\| ""/);
  assert.match(source, /return \{ cells, imageUrl \}/);
});

test("internal catalog sync uses the selected store browser profile", async () => {
  const source = await readFile("scripts/sync-noon-catalog-internal-api.js", "utf8");
  assert.match(source, /\.noon-profiles/);
  assert.match(source, /noon-store\/list/);
  assert.match(source, /offer\/list\/noon/);
  assert.doesNotMatch(source, /STR517205-NSA/);
});

test("internal catalog URL only accepts the exact Noon Catalog hostname", () => {
  assert.equal(
    assertNoonCatalogUrl("https://noon-catalog.noon.partners/en/catalog?project=PRJ517205").hostname,
    "noon-catalog.noon.partners",
  );
  assert.throws(() => assertNoonCatalogUrl("not a URL"), /Catalog 地址无效/);
  assert.throws(() => assertNoonCatalogUrl("https://attacker.example/"), /必须使用 noon-catalog\.noon\.partners/);
  assert.throws(() => assertNoonCatalogUrl("https://noon-catalog.noon.partners.attacker.example/"), /必须使用 noon-catalog\.noon\.partners/);
});

test("internal catalog store parser matches project_code exactly", () => {
  const payload = {
    noon_stores: [
      { project_code: "PRJ000001", noon_store_code: "STORE-ONE" },
      { project_code: "PRJ517205", noon_store_code: "STORE-TWO" },
    ],
  };
  assert.equal(findNoonStoreCode(payload, "PRJ517205"), "STORE-TWO");
  assert.throws(() => findNoonStoreCode(payload, "PRJ-NOT-FOUND"), /找不到项目 PRJ-NOT-FOUND/);
  assert.throws(() => findNoonStoreCode({}, "PRJ517205"), /缺少 noon_stores/);
});
