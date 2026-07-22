import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { readUiSettings, saveUiSettings, projectRoot } from "./settings";

export type NoonStore = {
  id: string;
  name: string;
  projectId: string;
  createdAt: string;
  url: string;
  hasApiToken: boolean;
};

type StoredNoonStore = Omit<NoonStore, "url" | "hasApiToken"> & { apiToken?: string };

const noonStoresFileName = ".noon-stores.json";
const noonUploadStatusFileName = "noon-upload-status.json";

export function normalizeNoonStoreId(value: unknown) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(id)) throw new Error("店铺 ID 必须是 2-12 位大写字母或数字。");
  return id;
}

export function noonStoreUrl(store: Pick<NoonStore, "projectId">) {
  const projectId = String(store.projectId || "").trim().toUpperCase();
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  return `https://noon-catalog.noon.partners/en/catalog/create?project=${encodeURIComponent(projectId)}`;
}

export async function listStores(rootDir = projectRoot()) {
  const [registry, settings] = await Promise.all([readStoreRegistry(rootDir), readUiSettings(rootDir)]);
  return {
    stores: registry.stores.map(publicStore),
    defaultStoreId: normalizeOptionalStoreId(settings.defaultStoreId),
  };
}

export async function createStore(body: unknown, rootDir = projectRoot()) {
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const store = validateStoreInput(input);
  const registry = await readStoreRegistry(rootDir);

  if (registry.stores.some((item) => item.id === store.id)) throw new Error(`店铺 ${store.id} 已存在。`);
  if (await storeIdHasUploadStatus(path.join(rootDir, "products"), store.id)) {
    const error = new Error(`店铺 ${store.id} 已存在上传状态，不能复用。`);
    error.name = "StoreConflictError";
    throw error;
  }

  const nextStore = { ...store, createdAt: new Date().toISOString() };
  const nextStores = [...registry.stores, nextStore];
  await writeStoreRegistry(rootDir, { stores: nextStores });

  const settings = await readUiSettings(rootDir);
  if (nextStores.length === 1 || !settings.defaultStoreId) {
    await saveUiSettings({ defaultStoreId: nextStore.id }, rootDir);
  }

  return { store: publicStore(nextStore) };
}

export async function deleteStore(id: string, rootDir = projectRoot()) {
  const registry = await readStoreRegistry(rootDir);
  const storeId = normalizeNoonStoreId(id);
  const index = registry.stores.findIndex((store) => store.id === storeId);
  if (index < 0) throw new Error(`店铺 ${storeId} 不存在。`);

  const [deleted] = registry.stores.splice(index, 1);
  await writeStoreRegistry(rootDir, registry);
  await rm(path.join(rootDir, ".noon-profiles", storeId), { recursive: true, force: true });

  const settings = await readUiSettings(rootDir);
  if (normalizeOptionalStoreId(settings.defaultStoreId) === storeId) {
    await saveUiSettings({ defaultStoreId: "" }, rootDir);
  }

  return { store: publicStore(deleted) };
}

export async function findStore(id: string, rootDir = projectRoot()) {
  const storeId = normalizeNoonStoreId(id);
  const registry = await readStoreRegistry(rootDir);
  const store = registry.stores.find((item) => item.id === storeId);
  return store ? publicStore(store) : null;
}

export async function findStoreSecret(id: string, rootDir = projectRoot()) {
  const storeId = normalizeNoonStoreId(id);
  const registry = await readStoreRegistry(rootDir);
  return registry.stores.find((item) => item.id === storeId) || null;
}

export async function updateStore(id: string, body: unknown, rootDir = projectRoot()) {
  const storeId = normalizeNoonStoreId(id);
  const input = body && typeof body === "object" ? body as Record<string, unknown> : {};
  const registry = await readStoreRegistry(rootDir);
  const index = registry.stores.findIndex((store) => store.id === storeId);
  if (index < 0) throw new Error(`店铺 ${storeId} 不存在。`);
  const current = registry.stores[index];
  const apiToken = cleanApiToken(input.apiToken ?? current.apiToken);
  registry.stores[index] = { ...current, apiToken };
  await writeStoreRegistry(rootDir, registry);
  return { store: publicStore(registry.stores[index]) };
}

export function noonStoreProfile(rootDir: string, storeId: string) {
  return path.relative(rootDir, path.join(rootDir, ".noon-profiles", normalizeNoonStoreId(storeId))) || ".";
}

function validateStoreInput(input: Record<string, unknown>): StoredNoonStore {
  const id = normalizeNoonStoreId(input.id);
  const name = String(input.name || "").trim();
  const projectId = String(input.projectId || "").trim().toUpperCase();
  if (name.length < 1 || name.length > 80) throw new Error("店铺名称必须是 1-80 个字符。");
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  const apiToken = cleanApiToken(input.apiToken);
  return { id, name, projectId, ...(apiToken ? { apiToken } : {}), createdAt: "" };
}

async function readStoreRegistry(rootDir: string): Promise<{ stores: StoredNoonStore[] }> {
  try {
    const raw = JSON.parse(await readFile(path.join(rootDir, noonStoresFileName), "utf8")) as unknown;
    if (!raw || typeof raw !== "object" || !Array.isArray((raw as { stores?: unknown }).stores)) {
      throw new Error("店铺注册表结构错误。");
    }
    return {
      stores: (raw as { stores: unknown[] }).stores.map(validateStoredStore),
    };
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return { stores: [] };
    throw error;
  }
}

async function writeStoreRegistry(rootDir: string, registry: { stores: StoredNoonStore[] }) {
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, noonStoresFileName), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

function validateStoredStore(store: unknown): StoredNoonStore {
  const input = store && typeof store === "object" ? store as Record<string, unknown> : {};
  const validated = validateStoreInput(input);
  const createdAt = String(input.createdAt || "").trim();
  if (!createdAt) throw new Error("店铺记录缺少 createdAt。");
  return { ...validated, createdAt };
}

function publicStore(store: StoredNoonStore): NoonStore {
  return {
    id: store.id,
    name: store.name,
    projectId: store.projectId,
    createdAt: store.createdAt,
    hasApiToken: Boolean(cleanApiToken(store.apiToken)),
    url: noonStoreUrl(store),
  };
}

function cleanApiToken(value: unknown) {
  return String(value || "").trim();
}

function normalizeOptionalStoreId(value: unknown) {
  try {
    return value ? normalizeNoonStoreId(value) : "";
  } catch {
    return "";
  }
}

async function storeIdHasUploadStatus(productsDir: string, storeId: string) {
  for (const statusPath of await findStatusFiles(productsDir)) {
    try {
      const raw = JSON.parse(await readFile(statusPath, "utf8")) as unknown;
      if (
        raw &&
        typeof raw === "object" &&
        (raw as { version?: unknown }).version === 2 &&
        (raw as { stores?: unknown }).stores &&
        Object.hasOwn((raw as { stores: object }).stores, storeId)
      ) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function findStatusFiles(dir: string): Promise<string[]> {
  let entries = [];
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }

  const files: string[] = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await findStatusFiles(fullPath)));
    if (entry.isFile() && entry.name === noonUploadStatusFileName) files.push(fullPath);
  }
  return files;
}
