#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeNoonBrowserError } from "./lib/noon-browser-errors.js";
import { syncNoonCatalogFromInternalApi } from "./lib/noon-catalog-internal-sync.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const storeId = args.storeId ?? args["store-id"] ?? "";
const mode = args.mode ?? "global";
const catalogUrl = args.catalogUrl ?? args["catalog-url"] ?? "https://noon-catalog.noon.partners/";
const profile = args.profile ?? path.join(".noon-profiles", storeId);

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  await main();
}

async function main() {
  try {
    assertNoonCatalogUrl(catalogUrl);
    const result = await syncNoonCatalogFromInternalApi({
      rootDir,
      storeId,
      mode,
      catalogUrl,
      openSession,
    });
    console.log(JSON.stringify(result));
  } catch (error) {
    console.log(JSON.stringify({
      status: "error",
      mode,
      storeId,
      catalogUrl,
      error: normalizeNoonBrowserError(error, profile),
      syncedAt: new Date().toISOString(),
    }));
    process.exitCode = 1;
  }
}

async function openSession({ catalogUrl: url }) {
  const { launchPersistentContext } = await importCloakBrowser();
  const context = await launchPersistentContext({
    userDataDir: path.resolve(rootDir, profile),
    headless: args.headless === "false" ? false : true,
    locale: "en-US",
    timezone: "Asia/Dubai",
    viewport: { width: 1440, height: 960 },
    humanize: true,
    humanPreset: "careful",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(url, { waitUntil: "domcontentloaded", timeout: 90000 });
    if (/login\.noon\.partners/i.test(page.url())) {
      throw new Error("Noon Catalog 未登录，请先在店铺管理里完成登录。");
    }
    assertNoonCatalogUrl(page.url());

    return {
      finalUrl: page.url(),
      async getStoreCode() {
        const payload = await page.evaluate(async () => {
          const response = await fetch("/_vs/mp/mp-noon-merchant-api/noon-store/list", { credentials: "include" });
          if (!response.ok) throw new Error(`Noon Store 请求失败：HTTP ${response.status}`);
          return response.json();
        });
        return findNoonStoreCode(payload, storeId);
      },
      listOffers(body) {
        return page.evaluate(async (requestBody) => {
          const response = await fetch("/_vs/mp/mp-noon-catalog-api-rocket/offer/list/noon", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(requestBody),
          });
          if (!response.ok) throw new Error(`Noon Offer 请求失败：HTTP ${response.status}`);
          return response.json();
        }, body);
      },
      close: () => context.close(),
    };
  } catch (error) {
    await context.close();
    throw error;
  }
}

export function assertNoonCatalogUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Noon Catalog 地址无效。");
  }
  if (url.protocol !== "https:" || url.hostname !== "noon-catalog.noon.partners") {
    throw new Error("Noon Catalog 地址必须使用 noon-catalog.noon.partners。");
  }
  return url;
}

export function findNoonStoreCode(payload, projectCode) {
  if (!Array.isArray(payload?.noon_stores)) {
    throw new Error("Noon Store 响应缺少 noon_stores。");
  }
  const selected = payload.noon_stores.find((store) => store?.project_code === projectCode);
  if (!selected) throw new Error(`找不到项目 ${projectCode} 对应的 Noon Store。`);
  if (!selected.noon_store_code) throw new Error(`项目 ${projectCode} 缺少 Noon Store Code。`);
  return selected.noon_store_code;
}

async function importCloakBrowser() {
  try {
    return await import("cloakbrowser");
  } catch (error) {
    try {
      return await import(pathToFileURL("/opt/homebrew/lib/node_modules/cloakbrowser/dist/index.js").href);
    } catch {
      throw error;
    }
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
