import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanText } from "./text-utils.js";

export async function applyBulkOperation({
  productsDir,
  productDirs = [],
  operation = {},
  operationCheckByProductDir = {},
} = {}) {
  const result = {
    operation: operation.type || "",
    changedCount: 0,
    skippedCount: 0,
    failedCount: 0,
    changed: [],
    skipped: [],
    failed: [],
  };

  for (const productDir of productDirs) {
    const check = operationCheckByProductDir[productDir];
    if (check?.status === "blocked" || (Array.isArray(check?.blockingIssues) && check.blockingIssues.length > 0)) {
      result.skippedCount += 1;
      result.skipped.push({
        productDir,
        reason: "blocked",
        blockingIssues: check.blockingIssues || [],
      });
      continue;
    }

    try {
      const filePath = safeProductFilePath(productsDir, productDir);
      const noon = JSON.parse(await readFile(filePath, "utf8"));
      const next = applyOperationToNoon(noon, operation);
      await writeFile(filePath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
      result.changedCount += 1;
      result.changed.push({ productDir });
    } catch (error) {
      result.failedCount += 1;
      result.failed.push({ productDir, error: error instanceof Error ? error.message : String(error) });
    }
  }

  return result;
}

export function applyOperationToNoon(noon, operation = {}) {
  const next = structuredClone(noon ?? {});
  const variants = Array.isArray(next.variants) ? next.variants : [];

  next.operation = next.operation && typeof next.operation === "object" ? next.operation : {};

  if (operation.type === "set_price") {
    const price = numberValue(operation.priceUsd);
    if (!(price > 0)) throw new Error("priceUsd must be greater than 0");
    for (const variant of variants) {
      variant.price_usd = price;
    }
    next.operation_status = "active";
    return next;
  }

  if (operation.type === "set_stock") {
    const stock = integerValue(operation.stock);
    if (!Number.isInteger(stock) || stock < 0) throw new Error("stock must be 0 or greater");
    for (const variant of variants) {
      variant.stock = stock;
    }
    next.operation_status = "active";
    return next;
  }

  if (operation.type === "deactivate") {
    next.operation_status = "inactive";
    for (const variant of variants) {
      variant.stock = 0;
    }
    return next;
  }

  if (operation.type === "set_processing_time") {
    const processingTime = cleanText(operation.processingTime);
    if (!processingTime) throw new Error("processingTime is required");
    next.operation.processing_time = processingTime;
    return next;
  }

  throw new Error(`Unsupported bulk operation: ${cleanText(operation.type)}`);
}

function safeProductFilePath(productsDir, productDir) {
  const root = path.resolve(productsDir);
  const fullPath = path.resolve(productsDir, productDir);
  if (fullPath !== root && !fullPath.startsWith(`${root}${path.sep}`)) {
    throw new Error("Invalid productDir");
  }
  return path.join(fullPath, "noon-product-attributes.json");
}

function numberValue(value) {
  if (typeof value === "number") {
    return Number.isFinite(value) && value > 0 ? value : Number.NaN;
  }

  const text = String(value ?? "").trim().replace(/,/g, "");
  if (!text || !/^\d+(?:\.\d+)?$/.test(text)) return Number.NaN;

  const number = Number(text);
  return Number.isFinite(number) && number > 0 ? number : Number.NaN;
}

function integerValue(value) {
  if (typeof value === "number") {
    return Number.isInteger(value) && Number.isFinite(value) ? value : Number.NaN;
  }

  const text = String(value ?? "").trim();
  if (!text || !/^\d+$/.test(text)) return Number.NaN;

  const number = Number(text);
  return Number.isInteger(number) && Number.isFinite(number) ? number : Number.NaN;
}
