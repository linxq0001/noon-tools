import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Noon catalog rows constrain long copy and recover from broken images", async () => {
  const workspace = await readFile(new URL("../src/app/noon-workbench/noon-workbench-workspace.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/app/noon-workbench/noon-workbench.css", import.meta.url), "utf8");

  assert.match(workspace, /function CatalogCover/);
  assert.match(workspace, /onError=\{\(\) => setFailed\(true\)\}/);
  assert.match(workspace, /loading="lazy"/);
  assert.match(workspace, /title=\{row\.title\}/);
  assert.match(css, /\.noon-sku-product-line > \* \{[\s\S]*?min-width: 0;/);
  assert.match(css, /\.noon-sku-copy strong \{[\s\S]*?-webkit-line-clamp: 2;/);
  assert.match(css, /\.noon-sku-copy span \{[\s\S]*?text-overflow: ellipsis;/);
});
