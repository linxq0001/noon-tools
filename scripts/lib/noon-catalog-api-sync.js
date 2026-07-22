import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createSign } from "node:crypto";

const DEFAULT_NOON_GATEWAY_URL = "https://noon-api-gateway.noon.partners";
const DEFAULT_NOON_IDENTITY_URL = `${DEFAULT_NOON_GATEWAY_URL}/identity`;
const DEFAULT_NOON_IMPEX_URL = `${DEFAULT_NOON_GATEWAY_URL}/impex`;
const DEFAULT_NOON_USER_AGENT = "NoonApiClient/1.0";

export async function syncNoonCatalogFromApi({
  rootDir = process.cwd(),
  storeId = "",
  country = "sa",
  noonStatus = "all",
  token,
  fetchImpl = fetch,
  now = () => new Date(),
  downloadIdleTimeoutMs = 60_000,
} = {}) {
  const env = await readLocalNoonEnv(rootDir);
  const storeToken = await readStoreApiToken(rootDir, storeId);
  const apiToken = storeToken || token || process.env.NOON_API_TOKEN || env.NOON_API_TOKEN;
  const configuredBaseUrl = cleanText(process.env.NOON_API_BASE_URL ?? env.NOON_API_BASE_URL);
  const authBaseUrl = configuredBaseUrl || DEFAULT_NOON_IDENTITY_URL;
  const impexBaseUrl = DEFAULT_NOON_IMPEX_URL;
  const auth = await noonAuthHeaders({ token: apiToken, baseUrl: authBaseUrl, fetchImpl });
  const statuses = noonStatus === "all" ? ["live", "not_live", "no_global_offer"] : [noonStatus];
  const allowedStatuses = new Set(["live", "not_live", "no_global_offer"]);
  if (statuses.some((status) => !allowedStatuses.has(status))) throw new Error(`Noon 导出状态无效：${noonStatus}`);
  const collectedRows = [];
  let lastEmptyExport = null;
  for (const status of statuses) {
    const result = await downloadGlobalCatalogExport({ fetchImpl, impexBaseUrl, auth, country, noonStatus: status, downloadIdleTimeoutMs });
    if (result.rows.length === 0) lastEmptyExport = result;
    else collectedRows.push(...result.rows);
  }
  const rows = [...new Map(collectedRows.map((row) => [row.catalogKey, row])).values()]
    .map(({ catalogKey: _catalogKey, ...row }) => row);
  if (rows.length === 0) {
    const { contentType, downloadBytes, exportHeaders } = lastEmptyExport;
    throw new Error(`Noon 导出文件未解析出 SKU（content-type=${contentType}, bytes=${downloadBytes.length}, signature=${downloadBytes.subarray(0, 8).toString("hex") || "empty"}, headers=${exportHeaders.slice(0, 30).join("|")}）。`);
  }
  console.log(`同步完成，共 ${rows.length} 条 SKU 数据`);

  // 5. write snapshot
  const data = {
    title: "Noon Global Catalog Export",
    textSample: "",
    headers: ["Product", "Price", "Inventory", "Performance", "Issues"],
    rows,
    totalPages: 1,
  };
  const mode = "global";
  const output = await writeSyncSnapshot({ rootDir, storeId, mode, data, now });
  return {
    status: "completed",
    mode,
    storeId,
    catalogUrl: "/v1/export/create",
    rowCount: rows.length,
    output,
    syncedAt: now().toISOString(),
  };
}

async function downloadGlobalCatalogExport({ fetchImpl, impexBaseUrl, auth, country, noonStatus, downloadIdleTimeoutMs }) {
  console.log(`正在创建 ${noonStatus} 导出任务...`);
  const createResp = await fetchImpl(`${impexBaseUrl}/v1/export/create`, {
    method: "POST",
    headers: { "user-agent": DEFAULT_NOON_USER_AGENT, "content-type": "application/json", ...auth },
    body: JSON.stringify({ export_category_code: "noon_catalog_globalcatalogexport", params: { country, noon_status: noonStatus } }),
  });
  const createPayload = await readJsonResponse(createResp);
  if (!createResp.ok) throw new Error(`Noon 导出创建失败：${noonApiErrorMessage(createPayload, createResp, impexBaseUrl)}`);
  const exportCode = createPayload.export_code;
  if (!exportCode) throw new Error("Noon 导出创建未返回 export_code。");
  console.log(`导出任务已创建，编号：${exportCode}`);

  let downloadUrl = "";
  let lastStatus = "PENDING";
  const t0 = Date.now();
  for (let i = 0; i < 720; i += 1) {
    const pollResp = await fetchImpl(`${impexBaseUrl}/v1/export/status`, {
      method: "POST",
      headers: { "user-agent": DEFAULT_NOON_USER_AGENT, "content-type": "application/json", ...auth },
      body: JSON.stringify({ export_code: exportCode }),
    });
    const pollPayload = await readJsonResponse(pollResp);
    if (!pollResp.ok) throw new Error(`Noon 导出状态查询失败：${noonApiErrorMessage(pollPayload, pollResp, impexBaseUrl)}`);
    lastStatus = pollPayload.export_status;
    if (["COMPLETE", "ERROR", "EXPIRED", "FAILED"].includes(lastStatus)) {
      if (lastStatus === "COMPLETE") downloadUrl = pollPayload.download_url || "";
      break;
    }
    console.log(`正在等待 ${noonStatus} 导出生成，已等待 ${Math.floor((Date.now() - t0) / 1000)} 秒...`);
    await sleep(5000);
  }
  if (lastStatus !== "COMPLETE") throw new Error(`Noon 导出未完成，状态：${lastStatus}`);
  if (!downloadUrl) throw new Error("Noon 导出完成但未返回下载链接。");

  console.log(`正在下载 ${noonStatus} 导出文件...`);
  const dlResp = await fetchDownloadResponse(fetchImpl, downloadUrl, downloadIdleTimeoutMs);
  if (!dlResp.ok) {
    void dlResp.body?.cancel?.().catch(() => {});
    throw new Error(`Noon 导出文件下载失败：HTTP ${dlResp.status}`);
  }
  const downloadBytes = await readDownloadBytes(dlResp, {
    idleTimeoutMs: downloadIdleTimeoutMs,
    onProgress: (byteCount) => console.log(`正在下载 ${noonStatus} 导出文件，已接收 ${(byteCount / 1024 / 1024).toFixed(1)} MB...`),
  });
  const csvText = downloadBytes.toString("utf8");
  const exportHeaders = parseCSVLine(csvText.split(/\r?\n/, 1)[0] || "").map((header) => header.trim());
  const hasPartnerSku = ["partner_sku", "psku_code"].some((header) => exportHeaders.includes(header));
  const hasNoonSku = ["sku_child", "zsku_child", "catalog_sku"].some((header) => exportHeaders.includes(header));
  if (!hasPartnerSku || !hasNoonSku) throw new Error(`Noon 导出文件无法识别 SKU 表头：${exportHeaders.slice(0, 30).join(", ") || "empty"}`);
  return {
    rows: parseGlobalCatalogCSV(csvText),
    contentType: cleanText(dlResp.headers.get("content-type")) || "unknown",
    downloadBytes,
    exportHeaders,
  };
}

async function fetchDownloadResponse(fetchImpl, downloadUrl, timeoutMs) {
  const controller = new AbortController();
  const timeoutError = new Error(`Noon 导出文件下载请求超过 ${timeoutMs} 毫秒未收到响应。`);
  const timer = setTimeout(() => controller.abort(timeoutError), timeoutMs);
  try {
    return await fetchImpl(downloadUrl, { signal: controller.signal });
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError;
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readDownloadBytes(response, { idleTimeoutMs, onProgress }) {
  if (!response.body?.getReader) {
    const arrayBuffer = await promiseWithTimeout(
      response.arrayBuffer(),
      idleTimeoutMs,
      `Noon 导出文件下载超过 ${idleTimeoutMs} 毫秒未收到新数据。`,
      () => cancelResponseBody(response.body),
    );
    return Buffer.from(arrayBuffer);
  }
  const reader = response.body.getReader();
  const chunks = [];
  let byteCount = 0;
  let nextProgressAt = 5 * 1024 * 1024;
  try {
    while (true) {
      const result = await readWithIdleTimeout(reader, idleTimeoutMs);
      if (result.done) break;
      const chunk = Buffer.from(result.value);
      chunks.push(chunk);
      byteCount += chunk.length;
      if (byteCount >= nextProgressAt) {
        onProgress(byteCount);
        nextProgressAt = byteCount + (5 * 1024 * 1024);
      }
    }
  } catch (error) {
    void reader.cancel(error).catch(() => {});
    throw error;
  }
  return Buffer.concat(chunks, byteCount);
}

function readWithIdleTimeout(reader, idleTimeoutMs) {
  return promiseWithTimeout(reader.read(), idleTimeoutMs, `Noon 导出文件下载超过 ${idleTimeoutMs} 毫秒未收到新数据。`);
}

function promiseWithTimeout(promise, timeoutMs, message, onTimeout) {
  let timer;
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      timer = setTimeout(() => {
        onTimeout?.();
        reject(new Error(message));
      }, timeoutMs);
    }),
  ]).finally(() => clearTimeout(timer));
}

function cancelResponseBody(body) {
  if (typeof body?.cancel === "function") void Promise.resolve(body.cancel()).catch(() => {});
  else if (typeof body?.destroy === "function") body.destroy();
}

function parseGlobalCatalogCSV(csvText) {
  const lines = csvText.split(/\r?\n/).filter(Boolean);
  if (lines.length === 0) return [];
  const rawHeaders = parseCSVLine(lines[0]);
  const headers = rawHeaders.map((h) => h.trim());
  const idx = (...names) => names.map((name) => headers.indexOf(name)).find((index) => index >= 0) ?? -1;
  const noonTitleIdx = idx("noon_title", "title", "product_title");
  const partnerSkuIdx = idx("partner_sku", "psku_code");
  const skuChildIdx = idx("sku_child", "zsku_child", "catalog_sku");
  const priceIdx = idx("price");
  const stockFbnIdx = idx("stock_fbn_net");
  const noonStatusIdx = idx("noon_status");

  return lines.slice(1).map((line, index) => {
    const cells = parseCSVLine(line);
    if (cells.length !== headers.length) throw new Error(`Noon 导出 CSV 第 ${index + 2} 行列数与表头不一致。`);
    const title = cleanText(cells[noonTitleIdx]);
    const psku = cleanText(cells[partnerSkuIdx]);
    const sku = cleanText(cells[skuChildIdx]);
    if (!psku && !sku) throw new Error(`Noon 导出 CSV 第 ${index + 2} 行数据行缺少 PSKU 和 SKU。`);
    const price = cleanText(cells[priceIdx]);
    const stock = cleanText(cells[stockFbnIdx]);
    const status = cleanText(cells[noonStatusIdx]);
    return {
      cells: [
        `${title} PSKU: ${psku || "-"} SKU: ${sku || "-"}`,
        price,
        stock,
        "",
        status,
      ],
      imageUrl: "",
      catalogKey: `${psku}\u0000${sku}`,
    };
  });
}

function parseCSVLine(line) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i += 1) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"' && line[i + 1] === '"') { current += '"'; i += 1; }
      else if (ch === '"') inQuotes = false;
      else current += ch;
    } else {
      if (ch === '"') inQuotes = true;
      else if (ch === ",") { result.push(current.trim()); current = ""; }
      else current += ch;
    }
  }
  if (inQuotes) throw new Error("Noon 导出 CSV 引号未闭合。");
  result.push(current.trim());
  return result;
}

function catalogRowsFromPayload(payload) {
  return readItems(payload).map((item) => {
    const partnerSku = cleanText(item.partner_sku ?? item.partnerSku ?? item.psku ?? item.sku);
    const noonSku = cleanText(item.zsku_child ?? item.zskuChild ?? item.zsku ?? item.noon_sku ?? item.noonSku ?? item.sku);
    const title = cleanText(item.title ?? item.product_title ?? item.productTitle ?? item.name) || partnerSku || noonSku || "-";
    return {
      cells: [
        `${title} PSKU: ${partnerSku || "-"} SKU: ${noonSku || "-"}`,
        cleanText(item.price ?? item.sale_price ?? item.salePrice ?? item.offer_price ?? item.offerPrice),
        cleanText(item.qty ?? item.stock ?? item.inventory ?? item.quantity),
        cleanText(item.performance ?? item.sales ?? item.gmv),
        cleanText(item.issues ?? item.issue ?? item.status_message ?? item.statusMessage),
      ],
      imageUrl: cleanText(item.image_url ?? item.imageUrl ?? item.image ?? item.image_link ?? item.imageLink),
    };
  });
}

async function writeSyncSnapshot({ rootDir, storeId, mode, data, now }) {
  const outputDir = path.join(rootDir, "exports", "noon-catalog-sync");
  await mkdir(outputDir, { recursive: true });
  const stamp = now().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}-${storeId || "store"}-${mode}.json`;
  const relativePath = path.join("exports", "noon-catalog-sync", fileName);
  await writeFile(
    path.join(rootDir, relativePath),
    `${JSON.stringify({ storeId, mode, catalogUrl: "/v1/export/create", ...data }, null, 2)}\n`,
    "utf8",
  );
  return relativePath;
}

async function readJsonResponse(response) {
  const text = await response.text();
  if (!text) return {};
  try { return JSON.parse(text); } catch { return { message: text }; }
}

function readItems(payload) {
  if (Array.isArray(payload)) return payload;
  if (!payload || typeof payload !== "object") return [];
  for (const key of ["items", "data", "results"]) {
    const value = payload[key];
    if (Array.isArray(value)) return value;
    if (value && typeof value === "object" && Array.isArray(value.items)) return value.items;
  }
  return [];
}

function apiErrorMessage(payload) {
  if (!payload || typeof payload !== "object") return "";
  return cleanText(payload.message ?? payload.error ?? payload.detail);
}

function noonApiErrorMessage(payload, response, baseUrl) {
  const message = apiErrorMessage(payload) || response.statusText || `HTTP ${response.status}`;
  if (message === "fault filter abort") {
    return `Noon 网关拒绝请求（${response.status} fault filter abort）。请确认 ${String(baseUrl).replace(/\/+$/, "")} 当前网络可访问、店铺 API 用户是 Project Owner、凭据未限制当前出口 IP，必要时关闭代理或更换网络后重试。`;
  }
  return message;
}

async function readLocalNoonEnv(rootDir) {
  const env = {};
  for (const fileName of [".env.local", ".env"]) {
    const filePath = path.join(rootDir, fileName);
    let content = "";
    try { content = await readFile(filePath, "utf8"); } catch { continue; }
    Object.assign(env, parseEnvContent(content));
  }
  return env;
}

async function readStoreApiToken(rootDir, storeId) {
  const id = cleanText(storeId).toUpperCase();
  if (!id) return "";
  try {
    const raw = JSON.parse(await readFile(path.join(rootDir, ".noon-stores.json"), "utf8"));
    const store = Array.isArray(raw?.stores) ? raw.stores.find((item) => cleanText(item?.id).toUpperCase() === id) : null;
    return tokenText(store?.apiToken);
  } catch { return ""; }
}

function parseEnvContent(content) {
  const env = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator <= 0) continue;
    const key = trimmed.slice(0, separator).trim();
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith("'") && value.endsWith("'")) || (value.startsWith('"') && value.endsWith('"'))) value = value.slice(1, -1);
    env[key] = value;
  }
  return env;
}

async function noonAuthHeaders({ token: value, baseUrl, fetchImpl }) {
  const token = tokenText(value);
  if (!token) throw new Error("缺少 NOON_API_TOKEN，无法调用 Noon Partner API。");
  if (!token.startsWith("{")) return { authorization: `Bearer ${token}` };
  const credential = JSON.parse(token);
  if (credential.type !== "apijwt") throw new Error("NOON_API_TOKEN JSON type 必须是 apijwt。");
  const keyId = tokenText(credential.key_id);
  const privateKey = tokenText(credential.private_key).replace(/\\n/g, "\n");
  const projectCode = tokenText(credential.project_code);
  if (!keyId || !privateKey) throw new Error("NOON_API_TOKEN 缺少 key_id 或 private_key。");
  const timestamp = Math.floor(Date.now() / 1000);
  const jwt = signJwt(
    { alg: "RS256", typ: "JWT" },
    { sub: keyId, iat: timestamp, jti: cryptoRandomUuid() },
    privateKey,
  );
  const response = await fetchImpl(`${String(baseUrl).replace(/\/+$/, "")}/public/v1/api/login`, {
    method: "POST",
    headers: { "user-agent": DEFAULT_NOON_USER_AGENT, "content-type": "application/json" },
    body: JSON.stringify({ token: jwt, ...(projectCode ? { default_project_code: projectCode } : {}) }),
  });
  const body = await readJsonResponse(response);
  if (!response.ok) throw new Error(`Noon APIJWT 登录失败：${noonApiErrorMessage(body, response, baseUrl)}`);
  const cookie = loginCookie(response.headers);
  return cookie ? { cookie } : {};
}

function loginCookie(headers) {
  const values = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return values.map((value) => String(value).split(";")[0]).filter(Boolean).join("; ");
}

function signJwt(header, claim, privateKey) {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signer = createSign("RSA-SHA256"); signer.update(unsigned); signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function cryptoRandomUuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function base64UrlJson(value) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function cleanText(value) { return String(value ?? "").replace(/\s+/g, " ").trim(); }

function tokenText(value) { return String(value ?? "").trim(); }

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
