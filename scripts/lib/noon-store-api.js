import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import {
  addNoonStore,
  deleteNoonStore,
  noonStoreUrl,
  normalizeNoonStoreId,
  readNoonStoreRegistry,
} from "./noon-stores.js";
import { noonUploadStatusFileName } from "./noon-upload-status.js";

export async function handleNoonStoreApi(options) {
  const method = String(options?.method || "").toUpperCase();
  const pathname = String(options?.pathname || "");
  const rootDir = options?.rootDir;

  if (method === "GET" && pathname === "/api/stores") {
    const registry = await readNoonStoreRegistry(rootDir);
    return ok({ stores: registry.stores.map(publicStore) });
  }

  if (method === "POST" && pathname === "/api/stores") {
    const id = normalizeNoonStoreId(options?.body?.id);
    if (await storeIdHasUploadStatus(options?.productsDir || path.join(rootDir, "products"), id)) {
      return json(409, { error: `店铺 ${id} 已存在上传状态，不能复用。` });
    }
    const store = await addNoonStore(rootDir, options?.body, { now: options?.now });
    const registry = await readNoonStoreRegistry(rootDir);
    if (registry.stores.length === 1 && typeof options?.setDefaultStoreId === "function") {
      await options.setDefaultStoreId(store.id);
    }
    return json(201, { store: publicStore(store) });
  }

  const deleteMatch = pathname.match(/^\/api\/stores\/([^/]+)$/);
  if (method === "DELETE" && deleteMatch) {
    const store = await deleteNoonStore(rootDir, decodeURIComponent(deleteMatch[1]));
    const currentDefault = typeof options?.getDefaultStoreId === "function" ? options.getDefaultStoreId() : "";
    if (normalizeDefaultStoreId(currentDefault) === store.id && typeof options?.setDefaultStoreId === "function") {
      await options.setDefaultStoreId("");
    }
    return ok({ store: publicStore(store) });
  }

  return { handled: false, status: 404, body: { error: "Not found" } };
}

function publicStore(store) {
  return {
    id: store.id,
    name: store.name,
    projectId: store.projectId,
    createdAt: store.createdAt,
    hasApiToken: Boolean(String(store.apiToken || "").trim()),
    url: noonStoreUrl(store),
  };
}

function ok(body) {
  return json(200, body);
}

function json(status, body) {
  return { handled: true, status, body };
}

function normalizeDefaultStoreId(value) {
  try {
    return normalizeNoonStoreId(value);
  } catch {
    return "";
  }
}

async function storeIdHasUploadStatus(productsDir, storeId) {
  for (const statusPath of await findStatusFiles(productsDir)) {
    try {
      const raw = JSON.parse(await readFile(statusPath, "utf8"));
      if (raw?.version === 2 && raw.stores && Object.hasOwn(raw.stores, storeId)) return true;
    } catch {
      return true;
    }
  }
  return false;
}

async function findStatusFiles(dir) {
  const files = [];
  let entries = [];

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return files;
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await findStatusFiles(fullPath)));
    } else if (entry.isFile() && entry.name === noonUploadStatusFileName) {
      files.push(fullPath);
    }
  }

  return files;
}
