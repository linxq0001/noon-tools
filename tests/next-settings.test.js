import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("readUiSettings returns empty object when settings file is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { readUiSettings } = await import("../src/lib/settings.ts");

  assert.deepEqual(await readUiSettings(rootDir), {});

  await rm(rootDir, { recursive: true, force: true });
});

test("saveUiSettings keeps only known string settings and writes updatedAt", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { saveUiSettings } = await import("../src/lib/settings.ts");

  const saved = await saveUiSettings({ url: "https://detail.1688.com", limit: 5, unknown: "drop" }, rootDir);
  const raw = JSON.parse(await readFile(path.join(rootDir, ".ui-settings.json"), "utf8"));

  assert.equal(saved.url, "https://detail.1688.com");
  assert.equal(saved.limit, "5");
  assert.equal(saved.unknown, undefined);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(raw, saved);

  await rm(rootDir, { recursive: true, force: true });
});

test("saveUiSettings merges with existing settings", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { saveUiSettings } = await import("../src/lib/settings.ts");

  await saveUiSettings({ url: "https://old.example", limit: "10" }, rootDir);
  const saved = await saveUiSettings({ limit: "20" }, rootDir);

  assert.equal(saved.url, "https://old.example");
  assert.equal(saved.limit, "20");

  await rm(rootDir, { recursive: true, force: true });
});
