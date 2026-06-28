import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(new URL("..", import.meta.url).pathname);

test("collect-1688 translates common source colours before fallback", async () => {
  const source = await readFile(new URL("../scripts/collect-1688.js", import.meta.url), "utf8");

  assert.match(source, /\["米色",\s*"Beige"\]/);
  assert.match(source, /\["酒红色",\s*"Wine Red"\]/);
});

test("collect-1688 falls back unknown source colours to stable noon colour families", async () => {
  const productDir = await mkdtemp(path.join(os.tmpdir(), "noon-colour-family-"));
  const metaPath = path.join(productDir, "meta.json");
  await mkdir(path.join(productDir, "images"));
  await writeFile(
    metaPath,
    JSON.stringify({
      productId: "999001",
      title: "女 晚宴包 手拿包",
      sourceTitle: "女 晚宴包 手拿包",
      sourceUrl: "https://detail.1688.com/offer/999001.html",
      attributes: {
        颜色: "藕粉色,青灰色,咖啡色,橘红色,酒红色",
        材质: "涤纶",
        里料质地: "PU",
        开盖方式: "磁扣",
        箱包形状: "椭圆形",
        适用场景: "日常搭配",
        硬度: "硬",
      },
      images: [],
      packageInfo: { weightG: "1000", dimensionsText: "19 x 6 x 14 cm" },
      price: "42",
    }),
    "utf8",
  );

  await execFileAsync(process.execPath, ["scripts/collect-1688.js", "--from-meta", metaPath], { cwd: rootDir });

  const noonProduct = JSON.parse(await readFile(path.join(productDir, "noon-product-attributes.json"), "utf8"));
  assert.deepEqual(noonProduct.variants.map((variant) => variant.colour), ["Pink", "Grey", "Brown", "Orange", "Red"]);
  assert.deepEqual(noonProduct.variants.map((variant) => variant.colour_name), ["Pink", "Grey", "Brown", "Orange Red", "Wine Red"]);
  assert.deepEqual(noonProduct.variants.map((variant) => variant.partner_sku), [
    "G-1001-999001-V01-PINK",
    "G-1001-999001-V02-GREY",
    "G-1001-999001-V03-BROWN",
    "G-1001-999001-V04-ORANGE-RED",
    "G-1001-999001-V05-WINE-RED",
  ]);
  assert.ok(noonProduct.product_group.description_en);
  assert.ok(noonProduct.product_group.description_ar);
  assert.ok(Array.isArray(noonProduct.product_group.feature_bullets_en));
  assert.ok(Array.isArray(noonProduct.product_group.feature_bullets_ar));
  assert.ok(noonProduct.variants.every((variant) => variant.subtitle_en));
  assert.ok(noonProduct.variants.every((variant) => variant.subtitle_ar));
  assert.ok(noonProduct.variants.every((variant) => !("description_en" in variant)));
  assert.ok(noonProduct.variants.every((variant) => !("description_ar" in variant)));
  assert.ok(noonProduct.variants.every((variant) => !("feature_bullets_en" in variant)));
  assert.ok(noonProduct.variants.every((variant) => !("feature_bullets_ar" in variant)));
});
