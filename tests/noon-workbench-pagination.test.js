import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("Noon workbench requests and renders one catalog page at a time", async () => {
  const source = await readFile(new URL("../src/app/noon-workbench/noon-workbench-workspace.tsx", import.meta.url), "utf8");

  assert.match(source, /type CatalogPagination = \{ page: number; pageSize: number; totalItems: number; totalPages: number \}/);
  assert.match(source, /import \{ Pager \} from "@\/components\/workbench\/pager"/);
  assert.match(source, /const \[catalogPageSize, setCatalogPageSize\] = useState\(50\)/);
  assert.match(source, /pageSize: String\(catalogPageSize\)/);
  assert.match(source, /setTotalCount\(result\.pagination\?\.totalItems \|\| 0\)/);
  assert.match(source, /catalogRequestController\.current\?\.abort\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /setCatalogPage\(result\.pagination\.page\)/);
  assert.match(source, /disabled=\{catalogLoading \|\| !selectedCount/);
  assert.match(source, /checked=\{selectedRowKeys\.has\(rowKey\(row\)\)\} disabled=\{catalogLoading\}/);
  assert.match(source, /<Pager/);
  assert.match(source, /disabled=\{catalogLoading\}/);
  assert.match(source, /setCatalogPageSize\(nextPageSize\)/);
  assert.match(source, /setCatalogPage\(1\)/);
});
