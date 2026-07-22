import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPagerItems } from "../src/lib/pager.ts";

test("buildPagerItems matches repository pagination windows", () => {
  assert.deepEqual(buildPagerItems(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(buildPagerItems(1, 20), [1, 2, 3, 4, 5, "ellipsis", 20]);
  assert.deepEqual(buildPagerItems(10, 20), [1, "ellipsis", 9, 10, 11, "ellipsis", 20]);
  assert.deepEqual(buildPagerItems(20, 20), [1, "ellipsis", 16, 17, 18, 19, 20]);
});

test("shared Pager exposes repository controls and loading guards", async () => {
  const source = await readFile(new URL("../src/components/workbench/pager.tsx", import.meta.url), "utf8");
  assert.match(source, /共 \{totalItems\} 条/);
  assert.match(source, /\[10, 20, 50\]/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /disabled=\{disabled/);
  assert.match(source, /aria-label="分页导航"/);
  assert.match(source, /aria-label="上一页"/);
  assert.match(source, /aria-label="下一页"/);
  assert.match(source, /aria-label="每页条数"/);
  assert.match(source, /aria-current=\{item === page \? "page" : undefined\}/);
  assert.match(source, /aria-hidden="true"/);
});
