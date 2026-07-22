/**
 * Logging utilities shared across upload scripts.
 */

export function logStep(scope, message) {
  console.log(`[${scope}] ${message}`);
}

export function logSample(scope, values, limit = 5, label = "样例") {
  for (const [index, value] of values.slice(0, limit).entries()) {
    console.log(`[${scope}] ${label}${index + 1}: ${value}`);
  }
}

export function formatLogValue(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const clipped = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  return `"${clipped}"`;
}

export function formatGroupRef(groupRef) {
  return [groupRef?.id, groupRef?.name, groupRef?.anchorPartnerSku].filter(Boolean).join(" / ") || "(unknown)";
}

export function fail(message) {
  console.error(`[failed] ${message}`);
  process.exit(1);
}
