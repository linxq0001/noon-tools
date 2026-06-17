import assert from "node:assert/strict";
import test from "node:test";
import {
  isLikelyDimensionImage,
  parseDimensionCandidates,
  resolveProductDimensions,
  selectDimensionVisionImages,
} from "../scripts/lib/dimension-extractor.js";

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

test("dimension extractor reads OCR centimeter labels and ignores strap length", () => {
  const [candidate] = parseDimensionCandidates(
    "120cm/47.2in 14.5cm/5.71in 20cm/7.87in 7cm/2.76in",
    "image_ocr",
    "010.jpg",
  );

  assert.deepEqual(
    {
      lengthCm: candidate.lengthCm,
      widthCm: candidate.widthCm,
      heightCm: candidate.heightCm,
      image: candidate.image,
    },
    { lengthCm: 20, widthCm: 7, heightCm: 14.5, image: "010.jpg" },
  );
});

test("dimension extractor uses inch OCR and ignores chain length", () => {
  const [candidate] = parseDimensionCandidates(
    "55cm/21.7in 18cm/7.09in 12cm/4.72in 1.97in",
    "image_ocr",
    "002.jpg",
  );

  assert.deepEqual(
    {
      lengthCm: candidate.lengthCm,
      widthCm: candidate.widthCm,
      heightCm: candidate.heightCm,
      image: candidate.image,
    },
    { lengthCm: 18, widthCm: 5, heightCm: 12, image: "002.jpg" },
  );
});

test("dimension extractor ignores broken inch OCR fragments", () => {
  const [candidate] = parseDimensionCandidates(
    "55cm/21.7in 早c72in 197in 12cm/4.72in 1.97in 09in 18cm/7",
    "image_ocr",
    "002.jpg",
  );

  assert.deepEqual(
    {
      lengthCm: candidate.lengthCm,
      widthCm: candidate.widthCm,
      heightCm: candidate.heightCm,
      image: candidate.image,
    },
    { lengthCm: 18, widthCm: 5, heightCm: 12, image: "002.jpg" },
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

test("dimension resolver reads package info colour dimension tables", () => {
  const result = resolveProductDimensions({
    packageInfo: {
      dimensionsText:
        "颜色 长(cm) 宽(cm) 高(cm) 体积(cm³) 重量(g) 金色 18 7 10 1260 420 银色 18 7 10 1260 420 浅金色 18 7 10 1260 420",
    },
  });

  assert.equal(result.source, "package_info");
  assert.equal(result.lengthCm, 18);
  assert.equal(result.widthCm, 7);
  assert.equal(result.heightCm, 10);
});

test("dimension image detector finds size chart candidates", () => {
  assert.equal(isLikelyDimensionImage({ path: "004.jpg", nearText: "尺寸 17 x 6 x 15 cm" }), true);
  assert.equal(isLikelyDimensionImage({ path: "main-gold.jpg", nearText: "金色主图" }), false);
  assert.equal(
    isLikelyDimensionImage({
      path: "images/015.jpg",
      sourceUrl: "https://cbu01.alicdn.com/img/ibank/O1CN01x5ToOa2CjBCwZBooA_!!2219549898509-0-cib.jpg",
    }),
    false,
  );
});

test("dimension vision candidates fall back to the last image", () => {
  const images = Array.from({ length: 8 }, (_, index) => ({ path: `images/${String(index + 1).padStart(3, "0")}.jpg` }));

  assert.deepEqual(selectDimensionVisionImages(images).map((image) => image.path), ["images/008.jpg"]);
});

test("dimension vision candidates stop at the last marked size image", () => {
  const images = [
    { path: "images/001.jpg", nearText: "尺寸 16 x 5 x 10 cm" },
    { path: "images/002.jpg" },
    { path: "images/003.jpg", nearText: "尺寸 18 x 7 x 10 cm" },
  ];

  assert.deepEqual(selectDimensionVisionImages(images).map((image) => image.path), ["images/003.jpg"]);
});
