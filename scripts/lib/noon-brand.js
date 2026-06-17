const genericBrandValues = new Set(["", "generic", "no brand", "none", "unbranded", "not applicable", "n/a"]);

export function normalizeBrandValue(value) {
  const brand = String(value || "").trim();
  return brand || "No Brand";
}

export function isNoBrandValue(value) {
  return genericBrandValues.has(normalizeBrandValue(value).toLowerCase());
}

export function brandCandidates(value) {
  const brand = normalizeBrandValue(value);
  const normalized = brand.toLowerCase();

  if (!isNoBrandValue(normalized)) return [brand];

  return ["No Brand", "Not Applicable", "Unbranded", "None", "Generic"];
}
