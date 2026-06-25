import { escapeRegExp } from "./text-utils.js";
export const defaultDimensions = {
  lengthCm: 17,
  widthCm: 6,
  heightCm: 15,
  source: "default",
  warning: "No page or image dimensions found; default clutch dimensions used.",
};

export function resolveProductDimensions({ attributes = [], packageInfo = {}, imageCandidates = [] } = {}) {
  const packageCandidates = parseDimensionCandidates(packageDimensionText(packageInfo), "package_info");
  const attributeCandidates = parseDimensionCandidates(
    (Array.isArray(attributes) ? attributes : []).map((item) => `${item.name || ""}: ${item.value || ""}`).join("\n"),
    "page_attribute",
  );

  if (packageCandidates.length > 0) return buildDimensionResult(packageCandidates, "package_info");
  if (attributeCandidates.length > 0) return buildDimensionResult(attributeCandidates, "page_attribute");
  if (imageCandidates.length > 0) return buildDimensionResult(imageCandidates, imageCandidates[0].source || "image_ocr");

  return { ...defaultDimensions, candidates: [], warnings: [defaultDimensions.warning] };
}

export function parseDimensionCandidates(text, source = "image_ocr", image = "") {
  const value = normalizeText(text);
  const candidates = [];

  const ocrMeasurements = parseOcrCentimeterMeasurements(value, source, image);
  if (ocrMeasurements) candidates.push(ocrMeasurements);

  const labelled = parseLabelledDimensions(value, source, image);
  if (labelled) candidates.push(labelled);

  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(?:x|\*|×|X)\s*(\d+(?:\.\d+)?)\s*(?:x|\*|×|X)\s*(\d+(?:\.\d+)?)(?:\s*(?:cm|厘米|公分))?/gi)) {
    candidates.push(candidate(Number(match[1]), Number(match[2]), Number(match[3]), source, image, match[0]));
  }

  return uniqueCandidates(candidates.filter(isCompleteDimension));
}

export function isLikelyDimensionImage(image) {
  const descriptiveText = normalizeText([image?.path, image?.alt, image?.nearText].filter(Boolean).join(" "));
  const sourceUrl = normalizeText(image?.sourceUrl);

  return (
    /尺寸|尺码|大小|size|cm|厘米|length|width|height|\d+\s*(?:x|\*|×)\s*\d+/i.test(descriptiveText) ||
    /尺寸|尺码|大小|size|dimension/i.test(sourceUrl)
  );
}

export function selectDimensionVisionImages(images = []) {
  const reversed = (Array.isArray(images) ? images : []).filter((image) => image?.path).reverse();
  const likely = reversed.find(isLikelyDimensionImage);

  return likely ? [likely] : reversed.slice(0, 1);
}

function parseLabelledDimensions(text, source, image) {
  const colourTable = parseColourDimensionTable(text, source, image);
  if (colourTable) return colourTable;

  const table = parseWidthHeightThicknessTable(text, source, image);
  if (table) return table;

  let length = labelledNumber(text, ["长", "长度", "length", "l"]);
  let width = labelledNumber(text, ["宽", "宽度", "width", "w"]);
  const height = labelledNumber(text, ["高", "高度", "height", "h"]);
  const thickness = labelledNumber(text, ["厚", "厚度", "depth", "d"]);

  if (!Number.isFinite(length) && Number.isFinite(width) && Number.isFinite(thickness)) {
    length = width;
    width = thickness;
  }

  if (![length, width, height].every((item) => Number.isFinite(item))) return null;
  return candidate(length, width, height, source, image, text);
}

function parseOcrCentimeterMeasurements(text, source, image) {
  if (source !== "image_ocr") return null;

  const centimeterNumbers = [...text.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:¢\s*)?[cC][mM]?\b/g)].map((match) => Number(match[1].replace(",", ".")));
  const inchNumbers = [...text.matchAll(/(\d+[.,]\d+)\s*(?:i\s*)?[iI][nN]\b/g)].map((match) => Number(match[1].replace(",", ".")) * 2.54);
  let unique = [...new Set([...centimeterNumbers, ...inchNumbers].map((number) => roundCm(number)).filter((number) => Number.isFinite(number) && number > 0 && number <= 80))];

  if (unique.length >= 4) {
    const max = Math.max(...unique);
    if (max >= 40) unique = unique.filter((number) => number < 40);
  }

  if (unique.length < 3) return null;

  const [lengthCm, heightCm, widthCm] = unique.sort((left, right) => right - left);
  return candidate(lengthCm, widthCm, heightCm, source, image, text);
}

function roundCm(value) {
  return Math.round(value * 10) / 10;
}

function parseColourDimensionTable(text, source, image) {
  if (!/长\s*\(\s*cm\s*\)/i.test(text) || !/宽\s*\(\s*cm\s*\)/i.test(text) || !/高\s*\(\s*cm\s*\)/i.test(text)) {
    return null;
  }

  const headerEnd = Math.max(
    text.search(/高\s*\(\s*cm\s*\)/i),
    text.search(/体积\s*\(\s*cm[³3]?\s*\)/i),
    text.search(/重量\s*\(\s*g\s*\)/i),
  );
  const valueText = text.slice(headerEnd);
  const numbers = [...valueText.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  for (let index = 0; index + 2 < numbers.length; index += 1) {
    const length = numbers[index];
    const width = numbers[index + 1];
    const height = numbers[index + 2];
    const volume = numbers[index + 3];

    if (Number.isFinite(volume) && Math.abs(length * width * height - volume) > Math.max(2, volume * 0.05)) continue;
    return candidate(length, width, height, source, image, text);
  }

  return null;
}

function parseWidthHeightThicknessTable(text, source, image) {
  if (!/宽度/.test(text) || !/高度/.test(text) || !/厚度/.test(text)) return null;

  const widthIndex = text.indexOf("宽度");
  const heightIndex = text.indexOf("高度");
  const thicknessIndex = text.indexOf("厚度");
  const valueText = text.slice(Math.max(widthIndex, heightIndex, thicknessIndex) + 2);
  const numbers = [...valueText.matchAll(/\d+(?:\.\d+)?/g)].map((match) => Number(match[0]));

  if (numbers.length < 3) return null;
  return candidate(numbers[0], numbers[2], numbers[1], source, image, text);
}

function labelledNumber(text, labels) {
  for (const label of labels) {
    const escaped = escapeRegExp(label);
    const patterns = [
      new RegExp(`${escaped}\\s*[:：]?\\s*(\\d+(?:\\.\\d+)?)\\s*(?:cm|厘米|公分)?`, "i"),
      new RegExp(`(\\d+(?:\\.\\d+)?)\\s*(?:cm|厘米|公分)?\\s*${escaped}`, "i"),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(text);
      if (match) return Number(match[1]);
    }
  }

  return null;
}

function buildDimensionResult(candidates, source) {
  const complete = uniqueCandidates(candidates.filter(isCompleteDimension));
  const ranked = [...complete].sort((left, right) => countMatches(right, complete) - countMatches(left, complete));
  const selected = ranked[0];
  const warning = hasConflict(complete) ? "Multiple conflicting dimensions found." : "";

  return {
    lengthCm: selected.lengthCm,
    widthCm: selected.widthCm,
    heightCm: selected.heightCm,
    source,
    candidates: complete,
    warnings: warning ? [warning] : [],
  };
}

function countMatches(target, candidates) {
  return candidates.filter(
    (item) => item.lengthCm === target.lengthCm && item.widthCm === target.widthCm && item.heightCm === target.heightCm,
  ).length;
}

function hasConflict(candidates) {
  const keys = new Set(candidates.map((item) => `${item.lengthCm}x${item.widthCm}x${item.heightCm}`));
  return keys.size > 1;
}

function uniqueCandidates(candidates) {
  const seen = new Set();
  const unique = [];

  for (const item of candidates) {
    const key = `${item.lengthCm}x${item.widthCm}x${item.heightCm}:${item.source}:${item.image || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(item);
  }

  return unique;
}

function candidate(lengthCm, widthCm, heightCm, source, image, evidence) {
  return {
    lengthCm,
    widthCm,
    heightCm,
    source,
    image,
    evidence: normalizeText(evidence).slice(0, 160),
  };
}

function isCompleteDimension(item) {
  return [item.lengthCm, item.widthCm, item.heightCm].every((number) => Number.isFinite(number) && number > 0 && number < 200);
}

function normalizeText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function packageDimensionText(packageInfo) {
  if (!packageInfo || typeof packageInfo !== "object") return "";

  return [
    packageInfo.dimensionsText,
    packageInfo.size,
    packageInfo.lengthCm && packageInfo.widthCm && packageInfo.heightCm
      ? `长${packageInfo.lengthCm}cm 宽${packageInfo.widthCm}cm 高${packageInfo.heightCm}cm`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}
