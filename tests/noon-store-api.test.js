import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { handleNoonStoreApi } from "../scripts/lib/noon-store-api.js";

const fixedNow = () => "2026-06-24T00:00:00.000Z";

test("store API lists, creates, and deletes stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-store-api-"));
  const productsDir = path.join(root, "products");

  assert.deepEqual((await handleNoonStoreApi({ method: "GET", pathname: "/api/stores", rootDir: root })).body.stores, []);

  const created = await handleNoonStoreApi({
    method: "POST",
    pathname: "/api/stores",
    body: { id: "UAE01", name: " Main UAE ", projectId: "prj517205" },
    rootDir: root,
    productsDir,
    now: fixedNow,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.store.id, "UAE01");
  assert.equal(created.body.store.name, "Main UAE");

  const listed = await handleNoonStoreApi({ method: "GET", pathname: "/api/stores", rootDir: root });
  assert.equal(listed.body.stores.length, 1);

  const removed = await handleNoonStoreApi({ method: "DELETE", pathname: "/api/stores/UAE01", rootDir: root });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.store.id, "UAE01");
});

test("deleting the default store clears only the default selection", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-store-api-default-"));
  let defaultStoreId = "UAE01";
  await handleNoonStoreApi({
    method: "POST",
    pathname: "/api/stores",
    body: { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" },
    rootDir: root,
    productsDir: path.join(root, "products"),
    now: fixedNow,
  });

  await handleNoonStoreApi({
    method: "DELETE",
    pathname: "/api/stores/UAE01",
    rootDir: root,
    getDefaultStoreId: () => defaultStoreId,
    setDefaultStoreId: (value) => { defaultStoreId = value; },
  });

  assert.equal(defaultStoreId, "");
});

test("store API rejects unhandled routes", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-store-api-unhandled-"));
  const result = await handleNoonStoreApi({ method: "PATCH", pathname: "/api/stores/UAE01", rootDir: root });

  assert.equal(result.handled, false);
});

test("store API rejects reuse when existing v2 statuses still reference the store", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-store-api-reuse-"));
  const productDir = path.join(root, "products", "1688", "default", "1001");
  await mkdir(productDir, { recursive: true });
  await handleNoonStoreApi({
    method: "POST",
    pathname: "/api/stores",
    body: { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" },
    rootDir: root,
    productsDir: path.join(root, "products"),
    now: fixedNow,
  });
  await handleNoonStoreApi({ method: "DELETE", pathname: "/api/stores/UAE01", rootDir: root });
  await import("../scripts/lib/noon-upload-status.js").then(({ writeStoreNoonUploadStatus }) =>
    writeStoreNoonUploadStatus(productDir, { status: "uploaded", partnerSku: "G-1001-1001-V01-BLACK-UAE01" }, "UAE01"),
  );

  const recreated = await handleNoonStoreApi({
    method: "POST",
    pathname: "/api/stores",
    body: { id: "UAE01", name: "Main UAE 2", projectId: "PRJ517206" },
    rootDir: root,
    productsDir: path.join(root, "products"),
    now: fixedNow,
  });

  assert.equal(recreated.status, 409);
});

test("server exposes store routes and derives noon job args from stores", async () => {
  const source = await readFile(new URL("../scripts/server.js", import.meta.url), "utf8");

  assert.match(source, /handleNoonStoreApi/);
  assert.match(source, /\/api\/stores/);
  assert.match(source, /storeLoginMatch/);
  assert.match(source, /storeStatusMatch/);
  assert.match(source, /buildNoonUploadIdentityArgs\(rootDir,\s*store\)/);
  assert.match(source, /findNoonStore\(rootDir,\s*storeId\)/);
  assert.doesNotMatch(source, /"storesJson"/);
  assert.doesNotMatch(source, /"noonUrl"/);
  assert.doesNotMatch(source, /defaultNoonProfile/);
});
