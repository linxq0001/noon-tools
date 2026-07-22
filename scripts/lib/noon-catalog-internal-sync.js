import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export async function syncNoonCatalogFromInternalApi({
  rootDir = process.cwd(),
  storeId = "",
  mode = "global",
  catalogUrl = "",
  openSession,
  pageSize = 100,
  concurrency = 8,
  now = () => new Date(),
  sleep = wait,
} = {}) {
  const session = await openSession({ catalogUrl, storeId });
  try {
    const noonStoreCode = cleanText(await session.getStoreCode());
    if (!noonStoreCode) throw new Error("找不到 Noon Store Code。");

    const first = validateOfferPage(await listOffersWithRateLimitRetry(session, offerRequest(1, pageSize, noonStoreCode), sleep), 1, pageSize);
    const pageCount = Math.max(1, Math.ceil(first.total / pageSize));
    const hits = [...first.hits];
    logProgress(1, pageCount, hits.length);

    for (let start = 2; start <= pageCount; start += concurrency) {
      const pages = Array.from(
        { length: Math.min(concurrency, pageCount - start + 1) },
        (_, index) => start + index,
      );
      const payloads = await Promise.all(
        pages.map((page) => listOffersWithRateLimitRetry(session, offerRequest(page, pageSize, noonStoreCode), sleep)),
      );
      const pageData = payloads.map((payload, index) => validateOfferPage(payload, pages[index], pageSize, first.total));
      pageData.forEach((data, index) => {
        hits.push(...data.hits);
        logProgress(pages[index], pageCount, hits.length);
      });
    }

    return writeInternalSnapshot({
      rootDir,
      storeId,
      mode,
      catalogUrl: session.finalUrl || catalogUrl,
      hits,
      now,
    });
  } finally {
    await session.close();
  }
}

export function catalogRowsFromInternalHits(hits) {
  const unique = new Map();
  hits.forEach((hit, index) => {
    const key = [hit?.partner_sku ?? hit?.psku_code, hit?.zsku_child ?? hit?.catalog_sku, hit?.psku_code].map(cleanText).join("\u0000");
    const stableKey = key.replaceAll("\u0000", "") ? key : `__unidentified__${index}`;
    if (!unique.has(stableKey)) unique.set(stableKey, hit);
  });
  return [...unique.values()].map((hit) => {
    const partnerSku = cleanText(hit?.partner_sku) || cleanText(hit?.psku_code);
    const noonSku = cleanText(hit?.zsku_child) || cleanText(hit?.catalog_sku);
    const title = cleanText(hit?.content?.title ?? hit?.title) || partnerSku || noonSku || "-";
    return {
      cells: [
        `${title} PSKU: ${partnerSku || "-"} SKU: ${noonSku || "-"}`,
        formatPrice(hit),
        formatInventory(hit),
        "-",
        formatIssues(hit),
      ],
      imageUrl: cleanText(hit?.content?.image ?? hit?.content?.image_url ?? hit?.content?.imageUrl ?? hit?.image_url ?? hit?.imageUrl),
    };
  });
}

function formatPrice(hit) {
  const price = cleanText(hit?.price ?? hit?.offer_price);
  const currency = cleanText(hit?.currency);
  if (!price || !currency || price.toLowerCase().includes(currency.toLowerCase())) return price;
  return `${currency} ${price}`;
}

function formatInventory(hit) {
  const stocks = [
    ["FBN", cleanText(hit?.fbn_stock)],
    ["FBP", cleanText(hit?.fbp_stock)],
  ].filter(([, value]) => value !== "");
  if (stocks.length) return stocks.map(([label, value]) => `${label}: ${value}`).join(", ");
  return cleanText(hit?.stock ?? hit?.qty ?? hit?.inventory);
}

function formatIssues(hit) {
  const parts = [
    ["Issues", readableValue(hit?.offer_issues)],
    ["Live", readableValue(hit?.live_status)],
    ["Seller", readableValue(hit?.seller_status)],
  ].filter(([, value]) => value);
  if (parts.length) return parts.map(([label, value]) => `${label}: ${value}`).join("; ");
  return cleanText(hit?.status ?? hit?.noon_status);
}

function readableValue(value) {
  if (Array.isArray(value)) return value.map(readableValue).filter(Boolean).join(", ");
  if (value && typeof value === "object") {
    return Object.entries(value).map(([key, item]) => `${key}: ${readableValue(item)}`).join(", ");
  }
  return cleanText(value);
}

function offerRequest(page, perPage, noonStoreCode) {
  return {
    page,
    per_page: perPage,
    filters: {},
    noon_store_code: noonStoreCode,
    sort: "",
    direction: "",
  };
}

function validateOfferPayload(payload) {
  if (!payload?.data || !Number.isInteger(payload.data.total) || payload.data.total < 0) {
    throw new Error("Noon 内部 API 响应缺少有效的 data.total。");
  }
  if (!Array.isArray(payload.data.hits)) {
    throw new Error("Noon 内部 API 响应缺少有效的 data.hits。");
  }
  return payload.data;
}

async function listOffersWithRateLimitRetry(session, body, sleep) {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      return await session.listOffers(body);
    } catch (error) {
      if (!/\bHTTP 429\b/.test(error instanceof Error ? error.message : "") || attempt === 4) throw error;
      await sleep(1000 * (2 ** attempt));
    }
  }
}

function validateOfferPage(payload, page, pageSize, expectedTotal) {
  const data = validateOfferPayload(payload);
  const total = expectedTotal ?? data.total;
  if (data.total !== total) {
    if (page >= 100 && data.total === 0 && total > pageSize * 99) {
      throw new Error(`Noon 内部 API 第 ${page} 页触发分页窗口上限，无法完整读取 ${total} 条商品；请使用导出同步。`);
    }
    throw new Error(`Noon 内部 API 第 ${page} 页总数发生变化（初始 ${total}，当前 ${data.total}）。`);
  }
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const expectedHits = page < pageCount ? pageSize : total - pageSize * (pageCount - 1);
  if (data.hits.length !== expectedHits) {
    throw new Error(`Noon 内部 API 第 ${page} 页数据不完整，预期 ${expectedHits} 条，实际 ${data.hits.length} 条。`);
  }
  return data;
}

async function writeInternalSnapshot({ rootDir, storeId, mode, catalogUrl, hits, now }) {
  const rows = catalogRowsFromInternalHits(hits);
  const syncedAt = now().toISOString();
  const outputDir = path.join(rootDir, "exports", "noon-catalog-sync");
  await mkdir(outputDir, { recursive: true });
  const fileName = `${syncedAt.replace(/[:.]/g, "-")}-${storeId || "store"}-${mode}.json`;
  const output = path.join("exports", "noon-catalog-sync", fileName);
  await writeFile(path.join(rootDir, output), `${JSON.stringify({
    storeId,
    mode,
    catalogUrl,
    title: "Noon Catalog",
    textSample: "",
    headers: ["Product", "Price", "Inventory", "Performance", "Issues"],
    rows,
    totalPages: 1,
  }, null, 2)}\n`, "utf8");
  return {
    status: "completed",
    mode,
    storeId,
    catalogUrl,
    finalUrl: catalogUrl,
    rowCount: rows.length,
    output,
    syncedAt,
  };
}

function logProgress(page, pageCount, count) {
  console.log(`正在读取 API 第 ${page}/${pageCount} 页，已获取 ${count} 条商品...`);
}

function cleanText(value) {
  return value === null || value === undefined ? "" : String(value).replace(/\s+/g, " ").trim();
}

function wait(delay) {
  return new Promise((resolve) => setTimeout(resolve, delay));
}
