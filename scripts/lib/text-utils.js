export function cleanText(value) {
  return value == null ? "" : String(value).trim();
}

export function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
