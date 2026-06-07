import assert from "node:assert/strict";
import test from "node:test";
import { isLikelyDimensionImage, parseDimensionCandidates, resolveProductDimensions } from "../scripts/lib/dimension-extractor.js";

test("dimension extractor parses labelled dimensions", () => {
  const [candidate] = parseDimensionCandidates("长17cm 宽6cm 高15cm", "image_ocr", "003.jpg");

  assert.deepEqual(
    {
      lengthCm: candidate.lengthCm,
      widthCm: candidate.widthCm,
      heightCm: candidate.heightCm,
      source: candidate.source,
      image: candidate.image,
    },
    { lengthCm: 17, widthCm: 6, heightCm: 15, source: "image_ocr", image: "003.jpg" },
  );
});

test("dimension extractor treats unlabelled triples as length width height", () => {
  const [candidate] = parseDimensionCandidates("17 x 6 x 15 cm", "image_ocr");

  assert.equal(candidate.lengthCm, 17);
  assert.equal(candidate.widthCm, 6);
  assert.equal(candidate.heightCm, 15);
});

test("dimension extractor maps width height thickness product parameter tables", () => {
  const [candidate] = parseDimensionCandidates("产品参数 宽度 高度 厚度 手提 肩带 重量 材质 19 9.5 6 7 105 0.27KG 特殊 尺寸单位为cm", "image_ocr", "006.jpg");

  assert.deepEqual(
    {
      lengthCm: candidate.lengthCm,
      widthCm: candidate.widthCm,
      heightCm: candidate.heightCm,
      image: candidate.image,
    },
    { lengthCm: 19, widthCm: 6, heightCm: 9.5, image: "006.jpg" },
  );
});

test("dimension resolver prefers page attributes and falls back to default", () => {
  const fromAttributes = resolveProductDimensions({
    attributes: [{ name: "尺寸", value: "17*6*15cm" }],
    imageCandidates: [{ lengthCm: 18, widthCm: 7, heightCm: 16, source: "image_ocr" }],
  });
  const fallback = resolveProductDimensions();

  assert.equal(fromAttributes.source, "page_attribute");
  assert.equal(fromAttributes.lengthCm, 17);
  assert.equal(fallback.source, "default");
  assert.deepEqual(fallback.warnings, ["No page or image dimensions found; default clutch dimensions used."]);
});

test("dimension resolver reads package info table dimensions first", () => {
  const result = resolveProductDimensions({
    packageInfo: {
      dimensionsText: "包装信息 商品件重尺 颜色 尺寸 长(cm) 宽(cm) 高(cm) 体积(cm³) 重量(g) 黑色 32*14*10cm 32 14 10 4480 310",
    },
    attributes: [{ name: "尺寸", value: "17*6*15cm" }],
  });

  assert.equal(result.source, "package_info");
  assert.equal(result.lengthCm, 32);
  assert.equal(result.widthCm, 14);
  assert.equal(result.heightCm, 10);
});

test("dimension image detector finds size chart candidates", () => {
  assert.equal(isLikelyDimensionImage({ path: "004.jpg", nearText: "尺寸 17 x 6 x 15 cm" }), true);
  assert.equal(isLikelyDimensionImage({ path: "main-gold.jpg", nearText: "金色主图" }), false);
});
