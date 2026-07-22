#!/usr/bin/env node

import { normalizeCatalogMode } from "./lib/noon-store-jobs.js";
import { syncNoonCatalogFromApi } from "./lib/noon-catalog-api-sync.js";

const args = parseArgs(process.argv.slice(2));
const mode = normalizeCatalogMode(args.mode || "global");
const storeId = args.storeId ?? args["store-id"] ?? "";

try {
  const country = args.country ?? args["country"] ?? "sa";
  const noonStatus = args.noonStatus ?? args["noon-status"] ?? "all";
  console.log(`正在通过 Noon Global Catalog Export 同步 SKU（${country}, ${noonStatus}）...`);
  const result = await syncNoonCatalogFromApi({ storeId, mode, country, noonStatus });
  console.log(`正在同步第 1/1 页，累计 ${result.rowCount} 条 SKU 数据...`);
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(JSON.stringify({
    status: "error",
    mode,
    storeId,
    catalogUrl: "/v1/catalog/items",
    error: error instanceof Error ? error.message : String(error),
    syncedAt: new Date().toISOString(),
  }));
  process.exitCode = 1;
}

function parseArgs(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) parsed[key] = "true";
    else {
      parsed[key] = next;
      index += 1;
    }
  }
  return parsed;
}
