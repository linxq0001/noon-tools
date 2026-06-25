import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const noonStoresFileName = ".noon-stores.json";

export function normalizeNoonStoreId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(id)) throw new Error("店铺 ID 必须是 2-12 位大写字母或数字。");
  return id;
}

export function validateNoonStore(input = {}) {
  const id = normalizeNoonStoreId(input.id);
  const name = String(input.name || "").trim();
  const projectId = String(input.projectId || "").trim().toUpperCase();
  if (name.length < 1 || name.length > 80) throw new Error("店铺名称必须是 1-80 个字符。");
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  return { id, name, projectId };
}

export function noonStoreProfileDir(rootDir, storeId) {
  return path.join(rootDir, ".noon-profiles", normalizeNoonStoreId(storeId));
}

export function noonStoreUrl(store) {
  const projectId = String(store?.projectId || "").trim().toUpperCase();
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  return `https://noon-catalog.noon.partners/en/catalog/create?project=${encodeURIComponent(projectId)}`;
}

export async function readNoonStoreRegistry(rootDir) {
  const filePath = path.join(rootDir, noonStoresFileName);
  let raw;

  try {
    raw = await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { stores: [] };
    }
    throw error;
  }

  const registry = JSON.parse(raw);
  if (!registry || typeof registry !== "object" || !Array.isArray(registry.stores)) {
    throw new Error("店铺注册表结构错误。");
  }
  const stores = registry.stores.map(validateStoredNoonStore);

  return { stores };
}

export async function writeNoonStoreRegistry(rootDir, registry) {
  await mkdir(rootDir, { recursive: true });
  await writeFile(path.join(rootDir, noonStoresFileName), `${JSON.stringify(registry, null, 2)}\n`, "utf8");
}

export async function addNoonStore(rootDir, input, options = {}) {
  const registry = await readNoonStoreRegistry(rootDir);
  const store = validateNoonStore(input);
  if (registry.stores.some((item) => item.id === store.id)) throw new Error(`店铺 ${store.id} 已存在。`);

  const createdAt = typeof options.now === "function" ? options.now() : new Date().toISOString();
  const nextStore = { ...store, createdAt };
  await writeNoonStoreRegistry(rootDir, {
    ...registry,
    stores: [...registry.stores, nextStore],
  });
  return nextStore;
}

export async function findNoonStore(rootDir, storeId) {
  const registry = await readNoonStoreRegistry(rootDir);
  const id = normalizeNoonStoreId(storeId);
  return registry.stores.find((store) => store.id === id) || null;
}

export async function deleteNoonStore(rootDir, storeId) {
  const registry = await readNoonStoreRegistry(rootDir);
  const id = normalizeNoonStoreId(storeId);
  const index = registry.stores.findIndex((store) => store.id === id);
  if (index < 0) throw new Error(`店铺 ${id} 不存在。`);

  const [deleted] = registry.stores.splice(index, 1);
  await writeNoonStoreRegistry(rootDir, registry);
  await rm(noonStoreProfileDir(rootDir, id), { recursive: true, force: true });
  return deleted;
}

function validateStoredNoonStore(store) {
  const validated = validateNoonStore(store);
  const createdAt = String(store?.createdAt || "").trim();
  if (!createdAt) throw new Error("店铺记录缺少 createdAt。");
  return { ...validated, createdAt };
}
