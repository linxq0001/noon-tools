import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  addNoonStore,
  deleteNoonStore,
  findNoonStore,
  noonStoreProfileDir,
  noonStoreUrl,
  normalizeNoonStoreId,
  readNoonStoreRegistry,
  validateNoonStore,
  writeNoonStoreRegistry,
} from "../scripts/lib/noon-stores.js";

test("validates canonical store input", () => {
  assert.deepEqual(validateNoonStore({ id: "uae01", name: " Main UAE ", projectId: "PRJ517205" }), {
    id: "UAE01",
    name: "Main UAE",
    projectId: "PRJ517205",
  });
  assert.throws(() => validateNoonStore({ id: "../x", name: "X", projectId: "PRJ1" }), /店铺 ID/);
  assert.throws(() => validateNoonStore({ id: "UAE01", name: "", projectId: "PRJ1" }), /店铺名称/);
  assert.throws(() => validateNoonStore({ id: "UAE01", name: "X", projectId: "517205" }), /projectId/);
});

test("normalizes store ids to canonical uppercase ids", () => {
  assert.equal(normalizeNoonStoreId(" uae01 "), "UAE01");
});

test("adds, finds, and rejects duplicate stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-"));
  const created = await addNoonStore(
    root,
    { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" },
    {
      now: () => "2026-06-24T00:00:00.000Z",
    },
  );
  assert.equal(created.createdAt, "2026-06-24T00:00:00.000Z");
  assert.equal((await findNoonStore(root, "uae01")).id, "UAE01");
  await assert.rejects(() => addNoonStore(root, created), /已存在/);
});

test("reads, writes, and validates the registry file", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-read-write-"));
  const registry = {
    stores: [{ id: "UAE01", name: "Main UAE", projectId: "PRJ517205", createdAt: "2026-06-24T00:00:00.000Z" }],
  };

  await writeNoonStoreRegistry(root, registry);
  assert.equal(
    await readFile(path.join(root, ".noon-stores.json"), "utf8"),
    `${JSON.stringify(registry, null, 2)}\n`,
  );
  assert.deepEqual(await readNoonStoreRegistry(root), registry);

  await writeFile(path.join(root, ".noon-stores.json"), "{", "utf8");
  await assert.rejects(() => readNoonStoreRegistry(root), /JSON/);
});

test("missing registry file returns default registry", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-missing-"));

  assert.deepEqual(await readNoonStoreRegistry(root), {
    stores: [],
  });
});

test("registry file with non-array stores throws a structure error", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-structure-"));
  await writeNoonStoreRegistry(root, {
    stores: { id: "UAE01" },
  });

  await assert.rejects(() => readNoonStoreRegistry(root), /结构/);
});

test("derives profile and URL without storing either", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-profile-"));
  assert.equal(noonStoreProfileDir(root, "UAE01"), path.join(root, ".noon-profiles", "UAE01"));
  assert.equal(noonStoreUrl({ projectId: "PRJ517205" }), "https://noon-catalog.noon.partners/en/catalog/create?project=PRJ517205");
});

test("deletes stores and clears their profile directory", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-delete-"));
  const profileDir = noonStoreProfileDir(root, "UAE01");
  await mkdir(profileDir, { recursive: true });
  await writeFile(path.join(profileDir, "marker.txt"), "x", "utf8");
  await addNoonStore(root, { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" }, { now: () => "2026-06-24T00:00:00.000Z" });

  const deleted = await deleteNoonStore(root, "uae01");

  assert.equal(deleted.id, "UAE01");
  await assert.rejects(() => readFile(path.join(profileDir, "marker.txt"), "utf8"));
  assert.equal(await findNoonStore(root, "UAE01"), null);
});
