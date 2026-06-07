import assert from "node:assert/strict";
import test from "node:test";
import { cleanProductTitle } from "../scripts/lib/title-cleaner.js";

test("title cleaner removes platform words and separates bag types", () => {
  const result = cleanProductTitle("跨境外贸热销高级感水钻晚宴包手拿包链条包 阿里巴巴", [
    { name: "箱包潮流款式", value: "晚宴包" },
  ]);

  assert.equal(result.title, "水钻 晚宴包 / 手拿包 / 链条包");
  assert.deepEqual(result.titleParts, ["晚宴包", "手拿包", "链条包"]);
  assert.equal(result.productTypeText, "晚宴包 / 手拿包 / 链条包");
});

test("title cleaner limits bag types to three by business priority", () => {
  const result = cleanProductTitle("小方包斜挎包单肩包手拿包晚宴包");

  assert.deepEqual(result.titleParts, ["晚宴包", "手拿包", "单肩包"]);
});
