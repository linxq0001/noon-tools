import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import {
  buildNoonCatalogSyncArgs,
  buildNoonLoginArgs,
  buildNoonStatusArgs,
  buildNoonUploadIdentityArgs,
} from "../scripts/lib/noon-store-jobs.js";
import { noonStoreUrl } from "../scripts/lib/noon-stores.js";

test("builds profile-safe login, status, and upload arguments", () => {
  const rootDir = path.join(os.tmpdir(), "noon-store-jobs-root");
  const store = { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" };

  assert.deepEqual(buildNoonLoginArgs(rootDir, store), [
    "scripts/login-noon.js",
    "--noon-url",
    noonStoreUrl(store),
    "--profile",
    ".noon-profiles/UAE01",
  ]);
  assert.deepEqual(buildNoonStatusArgs(rootDir, store), [
    "scripts/check-noon-status.js",
    "--noon-url",
    noonStoreUrl(store),
    "--profile",
    ".noon-profiles/UAE01",
  ]);
  assert.deepEqual(buildNoonUploadIdentityArgs(rootDir, store), [
    "--noon-url",
    noonStoreUrl(store),
    "--profile",
    ".noon-profiles/UAE01",
    "--store-id",
    "UAE01",
  ]);
  assert.deepEqual(buildNoonCatalogSyncArgs(rootDir, store, "global"), [
    "scripts/sync-noon-catalog-api.js",
    "--store-id",
    "UAE01",
    "--mode",
    "global",
  ]);
});
