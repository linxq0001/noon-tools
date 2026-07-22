import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import {
  deleteNoonChildSkus,
  type NoonChildSkuDeleteItem,
  type NoonPricingItem,
  type NoonProductUpsertItem,
  type NoonStockItem,
  updateNoonStock,
  upsertNoonPricing,
  upsertNoonProducts,
} from "./noon-api-client.ts";
import { productsRoot, projectRoot } from "./products.ts";

type NoonVariant = Record<string, unknown>;
type NoonProduct = {
  variants?: NoonVariant[];
};

type SelectedBulkItem = {
  partner_sku?: unknown;
  zsku_child?: unknown;
  warehouse_code?: unknown;
};

type BulkOperation =
  | { type: "set_attribute"; field?: unknown; value?: unknown }
  | { type: "set_price"; countryCodes?: unknown; price?: unknown; priceUsd?: unknown }
  | { type: "set_stock"; stock?: unknown; warehouseCode?: unknown }
  | { type: "set_processing_time"; processingTime?: unknown; warehouseCode?: unknown }
  | { type: "delete_products" };

type ApplyOptions = {
  rootDir?: string;
  skus?: unknown[];
  items?: SelectedBulkItem[];
  operation: BulkOperation;
  apiOptions?: Parameters<typeof upsertNoonPricing>[1];
};

type ResolvedLocalItem = {
  productDir: string;
  partnerSku: string;
  warehouseCode: string;
};

export async function resolveProductDirsForSkus({
  rootDir = projectRoot(),
  skus = [],
}: {
  rootDir?: string;
  skus?: unknown[];
}) {
  const requestedSkus = [...new Set(skus.map(cleanText).filter(Boolean))];
  const productDirs = await listNoonProductDirs(productsRoot(rootDir));
  const matches = new Set<string>();
  const resolvedSkus = new Set<string>();

  for (const productDir of productDirs) {
    const productSkus = await readProductSkus(path.join(productsRoot(rootDir), productDir));
    for (const sku of requestedSkus) {
      if (!productSkus.has(sku)) continue;
      matches.add(productDir);
      resolvedSkus.add(sku);
    }
  }

  return {
    productDirs: [...matches].sort(),
    unresolvedSkus: requestedSkus.filter((sku) => !resolvedSkus.has(sku)),
  };
}

export async function applyNoonWorkbenchBulkAction({
  rootDir = projectRoot(),
  skus = [],
  items = [],
  operation,
  apiOptions,
}: ApplyOptions) {
  const selectedItems = selectedItemsFromInput(items, skus);
  const partnerSkus = [...new Set(selectedItems.map((item) => item.partnerSku).filter(Boolean))];
  const resolved = await resolveProductDirsForSkus({ rootDir, skus: partnerSkus });
  const localItems = await resolveLocalItems(rootDir, selectedItems);

  if (!partnerSkus.length) throw new Error("请先选择要操作的 Noon 商品。");

  let response: unknown;
  let submittedCount = 0;
  if (operation.type === "set_attribute") {
    const apiItems = partnerSkus.map((partnerSku) => buildProductUpsertItem(partnerSku, operation));
    submittedCount = apiItems.length;
    response = await upsertNoonProducts(apiItems, apiOptions);
  } else if (operation.type === "set_price") {
    const apiItems = buildPricingItems(partnerSkus, operation);
    submittedCount = apiItems.length;
    response = await upsertNoonPricing(apiItems, apiOptions);
  } else if (operation.type === "set_stock") {
    const apiItems = buildStockItems(selectedItems, localItems, operation);
    submittedCount = apiItems.length;
    response = await updateNoonStock(apiItems, apiOptions);
  } else if (operation.type === "set_processing_time") {
    const apiItems = buildProcessingTimeItems(selectedItems, localItems, operation);
    submittedCount = apiItems.length;
    response = await updateNoonStock(apiItems, apiOptions);
  } else if (operation.type === "delete_products") {
    const apiItems = buildDeleteItems(selectedItems);
    submittedCount = apiItems.length;
    response = await deleteNoonChildSkus(apiItems, apiOptions);
  } else {
    throw new Error("不支持的批量操作。");
  }

  const failed = apiFailures(response);
  return {
    ...resolved,
    operation: operation.type,
    changedCount: Math.max(0, submittedCount - failed.length),
    failedCount: failed.length,
    failed,
    response,
  };
}

async function listNoonProductDirs(productsDir: string, prefix = ""): Promise<string[]> {
  let entries = [];
  try {
    entries = await readdir(path.join(productsDir, prefix), { withFileTypes: true });
  } catch {
    return [];
  }

  const productDirs = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const relativeDir = prefix ? `${prefix}/${entry.name}` : entry.name;
    const fullPath = path.join(productsDir, relativeDir);
    try {
      await readFile(path.join(fullPath, "noon-product-attributes.json"), "utf8");
      productDirs.push(relativeDir);
    } catch {
      productDirs.push(...(await listNoonProductDirs(productsDir, relativeDir)));
    }
  }
  return productDirs;
}

async function readProductSkus(productDir: string) {
  const product = JSON.parse(await readFile(path.join(productDir, "noon-product-attributes.json"), "utf8")) as NoonProduct;
  const skus = new Set<string>();
  for (const variant of Array.isArray(product.variants) ? product.variants : []) {
    for (const value of [variant.partner_sku, variant.model_number, variant.barcode]) {
      const sku = cleanText(value);
      if (sku) skus.add(sku);
    }
  }
  return skus;
}

async function resolveLocalItems(rootDir: string, selectedItems: Array<{ partnerSku: string }>) {
  const wanted = new Set(selectedItems.map((item) => item.partnerSku));
  const productDirs = await listNoonProductDirs(productsRoot(rootDir));
  const result = new Map<string, ResolvedLocalItem>();
  for (const productDir of productDirs) {
    const product = await readNoonProduct(path.join(productsRoot(rootDir), productDir));
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      const partnerSku = cleanText(variant.partner_sku || variant.model_number || variant.barcode);
      if (!partnerSku || !wanted.has(partnerSku)) continue;
      result.set(partnerSku, {
        productDir,
        partnerSku,
        warehouseCode: cleanText(variant.warehouse_code || variant.warehouseCode),
      });
    }
  }
  return result;
}

async function readNoonProduct(productDir: string) {
  return JSON.parse(await readFile(path.join(productDir, "noon-product-attributes.json"), "utf8")) as NoonProduct;
}

function selectedItemsFromInput(items: SelectedBulkItem[], skus: unknown[]) {
  const selected = items
    .map((item) => ({
      partnerSku: cleanText(item.partner_sku),
      zskuChild: cleanText(item.zsku_child),
      warehouseCode: cleanText(item.warehouse_code),
    }))
    .filter((item) => item.partnerSku || item.zskuChild);
  if (selected.length) return selected.map((item) => ({ ...item, partnerSku: item.partnerSku || item.zskuChild }));
  return [...new Set(skus.map(cleanText).filter(Boolean))].map((sku) => ({ partnerSku: sku, zskuChild: "", warehouseCode: "" }));
}

function buildProductUpsertItem(partnerSku: string, operation: Extract<BulkOperation, { type: "set_attribute" }>): NoonProductUpsertItem {
  const field = cleanText(operation.field);
  const value = cleanText(operation.value);
  if (!field || !value) throw new Error("商品属性格式不正确，请使用 字段=值。");
  if (field === "hs_code") return { partner_sku: partnerSku, hs_code: value };
  if (field === "actual_weight_kg") return { partner_sku: partnerSku, actual_weight_kg: positiveNumber(value, field) };
  if (field === "vm_weight_cm") return { partner_sku: partnerSku, vm_weight_cm: positiveNumber(value, field) };
  if (field === "dimensions_cm") {
    const [length, width, height] = value.split(",").map((part) => positiveNumber(part, field));
    if (!length || !width || !height) throw new Error("dimensions_cm 需要 length,width,height，例如 dimensions_cm=17,6,15。");
    return { partner_sku: partnerSku, dimensions_cm: { length, width, height } };
  }
  throw new Error("商品属性仅支持 hs_code、actual_weight_kg、vm_weight_cm、dimensions_cm。");
}

function buildPricingItems(partnerSkus: string[], operation: Extract<BulkOperation, { type: "set_price" }>): NoonPricingItem[] {
  const price = positiveNumber(operation.price ?? operation.priceUsd, "price");
  const countryCodes = countryCodesFromInput(operation.countryCodes);
  return partnerSkus.flatMap((partnerSku) => countryCodes.map((country_code) => ({ partner_sku: partnerSku, country_code, price })));
}

function buildStockItems(
  selectedItems: Array<{ partnerSku: string; warehouseCode: string }>,
  localItems: Map<string, ResolvedLocalItem>,
  operation: Extract<BulkOperation, { type: "set_stock" }>,
): NoonStockItem[] {
  const qty = nonNegativeInteger(operation.stock, "qty");
  return selectedItems.map((item) => ({
    warehouse_code: warehouseCodeForItem(item, localItems, operation.warehouseCode),
    partner_sku: item.partnerSku,
    qty,
  }));
}

function buildProcessingTimeItems(
  selectedItems: Array<{ partnerSku: string; warehouseCode: string }>,
  localItems: Map<string, ResolvedLocalItem>,
  operation: Extract<BulkOperation, { type: "set_processing_time" }>,
): NoonStockItem[] {
  const processingTime = cleanText(operation.processingTime);
  if (!processingTime) throw new Error("processingTime is required");
  return selectedItems.map((item) => ({
    warehouse_code: warehouseCodeForItem(item, localItems, operation.warehouseCode),
    partner_sku: item.partnerSku,
    processing_time: processingTime,
  }));
}

function buildDeleteItems(selectedItems: Array<{ partnerSku: string; zskuChild: string }>): NoonChildSkuDeleteItem[] {
  return selectedItems.map((item) => {
    if (!item.zskuChild) throw new Error("批量删除需要 Noon zsku_child；当前 SKU 数据缺少该字段。");
    return { partner_sku: item.partnerSku, zsku_child: item.zskuChild };
  });
}

function warehouseCodeForItem(item: { partnerSku: string; warehouseCode: string }, localItems: Map<string, ResolvedLocalItem>, fallback: unknown) {
  const warehouseCode = item.warehouseCode || cleanText(fallback) || localItems.get(item.partnerSku)?.warehouseCode || "";
  if (!warehouseCode) throw new Error(`SKU ${item.partnerSku} 缺少 warehouse_code，库存/时效更新需要仓库码。`);
  return warehouseCode;
}

function countryCodesFromInput(value: unknown): Array<"ae" | "sa" | "eg"> {
  const raw = cleanText(value) || "ae,sa";
  const codes = raw.split(",").map((code) => cleanText(code).toLowerCase()).filter(Boolean);
  const valid = new Set(["ae", "sa", "eg"]);
  for (const code of codes) {
    if (!valid.has(code)) throw new Error("国家代码仅支持 ae、sa、eg。");
  }
  return [...new Set(codes)] as Array<"ae" | "sa" | "eg">;
}

function apiFailures(response: unknown) {
  const items = response && typeof response === "object" && Array.isArray((response as { items?: unknown[] }).items)
    ? (response as { items: Array<Record<string, unknown>> }).items
    : [];
  return items
    .filter((item) => {
      const status = item.status;
      if (!status || typeof status !== "object") return false;
      const code = cleanText((status as Record<string, unknown>).status_code).toLowerCase();
      const id = Number((status as Record<string, unknown>).status_id || 0);
      return Boolean(code && !["ok", "success", "successful"].includes(code)) || id > 0;
    })
    .map((item) => ({
      partnerSku: cleanText(item.partner_sku),
      error: cleanText((item.status as Record<string, unknown>)?.message) || "Noon API item failed",
    }));
}

function positiveNumber(value: unknown, label: string) {
  const number = Number(cleanText(value).replace(/,/g, ""));
  if (!Number.isFinite(number) || number <= 0) throw new Error(`${label} must be greater than 0`);
  return number;
}

function nonNegativeInteger(value: unknown, label: string) {
  const number = Number(cleanText(value));
  if (!Number.isInteger(number) || number < 0) throw new Error(`${label} must be 0 or greater`);
  return number;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}
