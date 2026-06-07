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
    attributes.map((item) => `${item.name || ""}: ${item.value || ""}`).join("\n"),
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

  const labelled = parseLabelledDimensions(value, source, image);
  if (labelled) candidates.push(labelled);

  for (const match of value.matchAll(/(\d+(?:\.\d+)?)\s*(?:x|\*|×|X)\s*(\d+(?:\.\d+)?)\s*(?:x|\*|×|X)\s*(\d+(?:\.\d+)?)(?:\s*(?:cm|厘米|公分))?/gi)) {
    candidates.push(candidate(Number(match[1]), Number(match[2]), Number(match[3]), source, image, match[0]));
  }

  return uniqueCandidates(candidates.filter(isCompleteDimension));
}

export function isLikelyDimensionImage(image) {
  const text = normalizeText([image?.sourceUrl, image?.path, image?.alt, image?.nearText].filter(Boolean).join(" "));
  return /尺寸|尺码|大小|size|cm|厘米|length|width|height|\d+\s*(?:x|\*|×)\s*\d+/i.test(text);
}

function parseLabelledDimensions(text, source, image) {
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

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
