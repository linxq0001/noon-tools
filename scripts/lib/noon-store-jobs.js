import path from "node:path";
import { noonStoreProfileDir, noonStoreUrl, normalizeNoonStoreId } from "./noon-stores.js";

export function buildNoonLoginArgs(rootDir, store) {
  return ["scripts/login-noon.js", "--noon-url", noonStoreUrl(store), "--profile", relativeProfile(rootDir, store.id)];
}

export function buildNoonStatusArgs(rootDir, store) {
  return ["scripts/check-noon-status.js", "--noon-url", noonStoreUrl(store), "--profile", relativeProfile(rootDir, store.id)];
}

export function buildNoonUploadIdentityArgs(rootDir, store) {
  return ["--noon-url", noonStoreUrl(store), "--profile", relativeProfile(rootDir, store.id), "--store-id", normalizeNoonStoreId(store.id)];
}

export function buildNoonCatalogSyncArgs(rootDir, store, mode = "global") {
  return [
    "scripts/sync-noon-catalog-api.js",
    "--store-id",
    normalizeNoonStoreId(store.id),
    "--mode",
    normalizeCatalogMode(mode),
  ];
}

export function noonStoreCatalogUrl(store) {
  const createUrl = new URL(noonStoreUrl(store));
  return `https://noon-catalog.noon.partners/en/catalog?project=${encodeURIComponent(createUrl.searchParams.get("project") || "")}`;
}

export function normalizeCatalogMode(value) {
  const mode = String(value || "").trim().toLowerCase();
  if (mode === "fbn" || mode === "fbp" || mode === "fbn_fbp") return "fbn";
  if (mode === "global" || mode === "ngs") return "global";
  throw new Error("Noon Catalog 模式不合法。");
}

function relativeProfile(rootDir, storeId) {
  return path.relative(rootDir, noonStoreProfileDir(rootDir, storeId)) || ".";
}
