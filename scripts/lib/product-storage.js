import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { cleanText } from "./text-utils.js";

export const defaultPlatform = "1688";
export const defaultRepositoryId = "default";

export function resolveRepositoryId(repository) {
  const value = cleanText(repository);
  if (!value) return defaultRepositoryId;
  return safePathSegment(value);
}

export function productStoragePath(productsDir, { platform = defaultPlatform, repository = "", productId }) {
  if (!productId) throw new Error("Missing productId.");
  return path.join(productsDir, safePathSegment(platform || defaultPlatform), resolveRepositoryId(repository), safePathSegment(productId));
}

export async function ensureRepository(productsDir, { platform = defaultPlatform, repository = "", name = "", sourceListUrl = "" } = {}) {
  const repositoryId = resolveRepositoryId(repository);
  const platformId = safePathSegment(platform || defaultPlatform);
  const repositoryDir = path.join(productsDir, platformId, repositoryId);
  const metadataPath = path.join(repositoryDir, "repository.json");

  await mkdir(repositoryDir, { recursive: true });

  let existing = null;
  try {
    existing = JSON.parse(await readFile(metadataPath, "utf8"));
  } catch {}

  if (existing) return { ...existing, dir: repositoryDir };

  const metadata = {
    id: repositoryId,
    name: cleanText(name) || (repositoryId === defaultRepositoryId ? "默认仓库" : repositoryId),
    platform: platformId,
    kind: repositoryId === defaultRepositoryId ? "default" : "batch",
    ...(sourceListUrl ? { sourceListUrl } : {}),
  };

  await writeJson(metadataPath, metadata);
  return { ...metadata, dir: repositoryDir };
}

export async function readPlatformRepositories(productsDir, platform = defaultPlatform) {
  const platformId = safePathSegment(platform || defaultPlatform);
  const platformDir = path.join(productsDir, platformId);
  const repositories = [];

  for (const entry of await readDirectory(platformDir)) {
    if (!entry.isDirectory()) continue;
    const repositoryDir = path.join(platformDir, entry.name);
    const productDirs = await readDirectProductDirs(repositoryDir, `${platformId}/${entry.name}`);
    if (productDirs.length === 0) continue;
    const metadata = (await readJsonIfExists(path.join(repositoryDir, "repository.json"))) || {
      id: entry.name,
      name: entry.name === defaultRepositoryId ? "默认仓库" : entry.name,
      platform: platformId,
      kind: entry.name === defaultRepositoryId ? "default" : "batch",
    };
    repositories.push({ ...metadata, productDirs });
  }

  repositories.push(...(await readLegacyRepositories(productsDir)));
  return mergeRepositories(repositories).sort((left, right) => left.id.localeCompare(right.id));
}

export async function readProductDirs(productsDir, { platform = "", repository = "" } = {}) {
  if (platform) {
    const repositories = await readPlatformRepositories(productsDir, platform);
    return repositories
      .filter((item) => !repository || item.id === repository)
      .flatMap((item) => item.productDirs);
  }

  const platformProducts = (await readPlatformRepositories(productsDir, defaultPlatform)).flatMap((item) => item.productDirs);
  const legacyProducts = await readLegacyProductDirs(productsDir);
  return uniqueBy([...platformProducts, ...legacyProducts], (item) => item.relativeDir);
}

export async function rebuildProductIndexes(productsDir, platform = defaultPlatform) {
  const platformId = safePathSegment(platform || defaultPlatform);
  const repositories = (await readPlatformRepositories(productsDir, platformId)).filter((repository) => repository.platform === platformId);
  const platformProducts = [];
  const repositorySummaries = [];

  for (const repository of repositories) {
    const products = [];

    for (const productDir of repository.productDirs) {
      const meta = (await readJsonIfExists(path.join(productDir.fullPath, "meta.json"))) || {};
      const noonAttributes = (await readJsonIfExists(path.join(productDir.fullPath, "noon-product-attributes.json"))) || {};
      const variants = Array.isArray(noonAttributes.variants) ? noonAttributes.variants : [];
      const product = {
        platform: platformId,
        repositoryId: repository.id,
        productId: cleanText(meta.productId) || path.basename(productDir.fullPath),
        title: cleanText(meta.title),
        status: cleanText(meta.status),
        variantCount: variants.length,
        imageCount: imageCount(meta, variants),
        updatedAt: cleanText(meta.collectedAt || meta.generatedAt),
        relativeDir: productDir.relativeDir,
      };
      products.push(product);
      platformProducts.push(product);
    }

    const repositoryIndex = {
      generatedAt: new Date().toISOString(),
      platform: platformId,
      repository: {
        id: repository.id,
        name: repository.name,
      },
      products,
    };
    await writeJson(path.join(productsDir, platformId, repository.id, "index.json"), repositoryIndex);

    repositorySummaries.push({
      id: repository.id,
      name: repository.name,
      productCount: products.length,
      imageCount: products.reduce((sum, product) => sum + product.imageCount, 0),
      readyCount: products.filter((product) => product.status === "ready").length,
      updatedAt: products.map((product) => product.updatedAt).sort().at(-1) || "",
    });
  }

  await mkdir(path.join(productsDir, platformId), { recursive: true });
  await writeJson(path.join(productsDir, platformId, "index.json"), {
    generatedAt: new Date().toISOString(),
    platform: platformId,
    repositories: repositorySummaries.sort((left, right) => left.id.localeCompare(right.id)),
    products: platformProducts.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir)),
  });
}

async function readLegacyRepositories(productsDir) {
  const repositories = [];
  const legacyDefault = [];

  for (const entry of await readDirectory(productsDir)) {
    if (!entry.isDirectory() || entry.name === defaultPlatform) continue;
    const dir = path.join(productsDir, entry.name);
    if (await hasMetaJson(dir)) {
      legacyDefault.push({ relativeDir: entry.name, fullPath: dir });
      continue;
    }

    const productDirs = await readDirectProductDirs(dir, entry.name);
    if (productDirs.length) {
      repositories.push({ id: entry.name, name: entry.name, platform: defaultPlatform, kind: "legacy", productDirs });
    }
  }

  if (legacyDefault.length) {
    repositories.unshift({
      id: defaultRepositoryId,
      name: "默认仓库",
      platform: defaultPlatform,
      kind: "legacy-default",
      productDirs: legacyDefault,
    });
  }

  return repositories;
}

async function readLegacyProductDirs(productsDir) {
  return (await readLegacyRepositories(productsDir)).flatMap((item) => item.productDirs);
}

async function readDirectProductDirs(dir, prefix) {
  const productDirs = [];

  for (const entry of await readDirectory(dir)) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    if (!(await hasMetaJson(fullPath))) continue;
    productDirs.push({ relativeDir: `${prefix}/${entry.name}`, fullPath });
  }

  return productDirs.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

async function hasMetaJson(dir) {
  try {
    await readFile(path.join(dir, "meta.json"), "utf8");
    return true;
  } catch {
    return false;
  }
}

async function readDirectory(dir) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJsonIfExists(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

async function writeJson(filePath, data) {
  await writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function safePathSegment(value) {
  const cleaned = cleanText(value)
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
  return cleaned || defaultRepositoryId;
}

function imageCount(meta, variants) {
  const variantImageCount = Math.max(
    0,
    ...variants.map((variant) => (Array.isArray(variant.images) ? variant.images.length : 0)),
  );
  if (variantImageCount > 0) return variantImageCount;
  if (Array.isArray(meta.images)) return meta.images.length;
  return Number(meta.downloadedCount) || 0;
}

function uniqueBy(items, keyFn) {
  const seen = new Set();
  const output = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    output.push(item);
  }
  return output;
}

function mergeRepositories(repositories) {
  const byId = new Map();

  for (const repository of repositories) {
    const current = byId.get(repository.id);
    if (!current) {
      byId.set(repository.id, { ...repository, productDirs: [...repository.productDirs] });
      continue;
    }

    current.productDirs = uniqueBy([...current.productDirs, ...repository.productDirs], (item) => item.relativeDir).sort(compareProductDirs);
  }

  return [...byId.values()];
}

function compareProductDirs(left, right) {
  const leftIsPlatform = left.relativeDir.startsWith(`${defaultPlatform}/`);
  const rightIsPlatform = right.relativeDir.startsWith(`${defaultPlatform}/`);
  if (leftIsPlatform !== rightIsPlatform) return leftIsPlatform ? -1 : 1;
  return left.relativeDir.localeCompare(right.relativeDir);
}
