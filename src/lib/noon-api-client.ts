import { createSign } from "node:crypto";

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

type NoonApiOptions = {
  baseUrl?: string;
  token?: string;
  fetchImpl?: FetchLike;
};

const DEFAULT_NOON_GATEWAY_URL = "https://noon-api-gateway.noon.partners";
const DEFAULT_NOON_IDENTITY_URL = `${DEFAULT_NOON_GATEWAY_URL}/identity`;
const DEFAULT_NOON_USER_AGENT = "NoonApiClient/1.0";

export type NoonPricingItem = {
  partner_sku: string;
  country_code: "ae" | "sa" | "eg";
  price?: number;
  msrp?: number;
  is_active?: boolean;
};

export type NoonStockItem = {
  warehouse_code: string;
  partner_sku: string;
  qty?: number;
  processing_time?: string;
};

export type NoonProductUpsertItem = {
  partner_sku: string;
  dimensions_cm?: { length: number; width: number; height: number };
  vm_weight_cm?: number;
  actual_weight_kg?: number;
  hs_code?: string;
};

export type NoonChildSkuDeleteItem = {
  partner_sku: string;
  zsku_child: string;
};

export async function noonApiRequest<T = unknown>(path: string, body?: unknown, options: NoonApiOptions = {}): Promise<T> {
  const configuredBaseUrl = cleanText(options.baseUrl ?? process.env.NOON_API_BASE_URL);
  const baseUrl = configuredBaseUrl || defaultBaseUrlForPath(path);
  const fetchImpl = options.fetchImpl ?? fetch;
  const headers = await noonAuthHeaders({
    token: options.token ?? process.env.NOON_API_TOKEN,
    baseUrl: configuredBaseUrl || DEFAULT_NOON_IDENTITY_URL,
    fetchImpl,
  });
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: {
      "user-agent": DEFAULT_NOON_USER_AGENT,
      ...headers,
      ...(body === undefined ? {} : { "content-type": "application/json" }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });

  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new Error(`Noon API 调用失败：${noonApiErrorMessage(payload, response, baseUrl)}`);
  }
  return payload as T;
}

export function upsertNoonPricing(items: NoonPricingItem[], options?: NoonApiOptions) {
  return noonApiRequest("/v1/pricing/upsert", { items }, options);
}

export function updateNoonStock(items: NoonStockItem[], options?: NoonApiOptions) {
  return noonApiRequest("/v1/stock-update", { items }, options);
}

export function upsertNoonProducts(items: NoonProductUpsertItem[], options?: NoonApiOptions) {
  return noonApiRequest("/v1/product/upsert", { items }, options);
}

export function deleteNoonChildSkus(items: NoonChildSkuDeleteItem[], options?: NoonApiOptions) {
  return noonApiRequest("/v1/sku/child/delete", { items }, options);
}

export function listNoonCatalogItems(options?: NoonApiOptions) {
  return noonApiRequest("/v1/catalog/items", undefined, options);
}

function parseJson(text: string) {
  try {
    return JSON.parse(text);
  } catch {
    return { message: text };
  }
}

function responseMessage(payload: unknown) {
  if (!payload || typeof payload !== "object") return "";
  const record = payload as Record<string, unknown>;
  return cleanText(record.message || record.error || record.detail);
}

function noonApiErrorMessage(payload: unknown, response: Response, baseUrl: string) {
  const message = responseMessage(payload) || response.statusText || `HTTP ${response.status}`;
  if (message === "fault filter abort") {
    return `Noon 网关拒绝请求（${response.status} fault filter abort）。请确认 ${baseUrl.replace(/\/+$/, "")} 当前网络可访问、店铺 API 用户是 Project Owner、凭据未限制当前出口 IP，必要时关闭代理或更换网络后重试。`;
  }
  return message;
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function defaultBaseUrlForPath(path: string) {
  if (path === "/v1/whoami" || path.startsWith("/identity/")) return DEFAULT_NOON_IDENTITY_URL;
  if (path === "/v1/catalog/items") return `${DEFAULT_NOON_GATEWAY_URL}/fbn/inbound`;
  if (path.startsWith("/v1/pricing/")) return `${DEFAULT_NOON_GATEWAY_URL}/pricing`;
  if (path === "/v1/stock-update" || path === "/v1/stock-list") return `${DEFAULT_NOON_GATEWAY_URL}/stock`;
  if (path === "/v1/product/upsert") return `${DEFAULT_NOON_GATEWAY_URL}/xborder-pricing`;
  if (path === "/v1/sku/child/delete") return `${DEFAULT_NOON_GATEWAY_URL}/catplat`;
  return DEFAULT_NOON_GATEWAY_URL;
}

async function noonAuthHeaders({
  token: value,
  baseUrl,
  fetchImpl,
}: {
  token: unknown;
  baseUrl: string;
  fetchImpl: FetchLike;
}): Promise<Record<string, string>> {
  const token = tokenText(value);
  if (!token) throw new Error("缺少 NOON_API_TOKEN，无法调用 Noon Partner API。");
  if (!token.startsWith("{")) return { authorization: `Bearer ${token}` };
  const credential = JSON.parse(token) as Record<string, unknown>;
  if (credential.type !== "apijwt") throw new Error("NOON_API_TOKEN JSON type 必须是 apijwt。");
  const keyId = tokenText(credential.key_id);
  const privateKey = tokenText(credential.private_key).replace(/\\n/g, "\n");
  const projectCode = tokenText(credential.project_code);
  if (!keyId || !privateKey) throw new Error("NOON_API_TOKEN 缺少 key_id 或 private_key。");

  const jwt = signJwt(
    { alg: "RS256", typ: "JWT" },
    {
      sub: keyId,
      iat: Math.floor(Date.now() / 1000),
      jti: cryptoRandomUuid(),
    },
    privateKey,
  );
  const response = await fetchImpl(`${baseUrl.replace(/\/+$/, "")}/public/v1/api/login`, {
    method: "POST",
    headers: {
      "user-agent": DEFAULT_NOON_USER_AGENT,
      "content-type": "application/json",
    },
    body: JSON.stringify({ token: jwt, ...(projectCode ? { default_project_code: projectCode } : {}) }),
  });
  const text = await response.text();
  const payload = text ? parseJson(text) : null;
  if (!response.ok) {
    throw new Error(`Noon APIJWT 登录失败：${noonApiErrorMessage(payload, response, baseUrl)}`);
  }
  const cookie = loginCookie(response.headers);
  return cookie ? { cookie } : {};
}

function cryptoRandomUuid() {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function tokenText(value: unknown) {
  return String(value ?? "").trim();
}

function signJwt(header: Record<string, unknown>, claim: Record<string, unknown>, privateKey: string) {
  const unsigned = `${base64UrlJson(header)}.${base64UrlJson(claim)}`;
  const signer = createSign("RSA-SHA256");
  signer.update(unsigned);
  signer.end();
  return `${unsigned}.${signer.sign(privateKey, "base64url")}`;
}

function base64UrlJson(value: Record<string, unknown>) {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

function loginCookie(headers: Headers) {
  const headerValues = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [headers.get("set-cookie")].filter(Boolean);
  return headerValues.map((value) => String(value).split(";")[0]).filter(Boolean).join("; ");
}
