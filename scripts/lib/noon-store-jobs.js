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

function relativeProfile(rootDir, storeId) {
  return path.relative(rootDir, noonStoreProfileDir(rootDir, storeId)) || ".";
}

