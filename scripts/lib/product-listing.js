import { readPlatformRepositories } from "./product-storage.js";

export function normalizeProductPageParams(input = {}) {
  const page = Math.max(1, Number.parseInt(input.page ?? "1", 10) || 1);
  const rawPageSize = Number.parseInt(input.pageSize ?? "20", 10) || 20;
  const pageSize = Math.min(100, Math.max(1, rawPageSize));
  const status = String(input.status || "").trim() === "all" ? "" : String(input.status || "").trim();
  const q = String(input.q || "").trim().toLowerCase();
  return { page, pageSize, status, q };
}

export async function listRepositorySummaries({ productsDir, storeId = "", readProductSummary, buildRepositorySummary } = {}) {
  const repositories = await readPlatformRepositories(productsDir, "1688");
  const summaries = [];

  for (const repository of repositories) {
    const products = [];
    for (const productDir of repository.productDirs) {
      products.push(await readProductSummary(productDir.relativeDir, repository.id, storeId));
    }
    const summary = buildRepositorySummary(repository.id, repository.name, products);
    delete summary.products;
    summaries.push(summary);
  }

  return summaries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function listRepositoryProducts({
  productsDir,
  repositoryId,
  storeId = "",
  page = 1,
  pageSize = 20,
  status = "",
  q = "",
  readProductSummary,
} = {}) {
  const repository = await findRepository(productsDir, repositoryId);
  if (!repository) return null;

  const products = [];
  for (const productDir of repository.productDirs) {
    const product = await readProductSummary(productDir.relativeDir, repository.id, storeId);
    if (status && productUploadStatus(product) !== status) continue;
    if (q && !productMatchesQuery(product, q)) continue;
    products.push(product);
  }

  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const currentPage = Math.min(Math.max(page, 1), totalPages);
  const start = (currentPage - 1) * pageSize;

  return {
    repository: {
      id: repository.id,
      name: repository.name,
      productCount: repository.productDirs.length,
    },
    products: products.slice(start, start + pageSize),
    pagination: {
      page: currentPage,
      pageSize,
      totalItems,
      totalPages,
    },
  };
}

export async function productDirsForRepository({ productsDir, repositoryId } = {}) {
  const repository = await findRepository(productsDir, repositoryId);
  return repository ? repository.productDirs.map((productDir) => productDir.relativeDir) : [];
}

export async function findRepositoryProductBySku({
  productsDir,
  partnerSku = "",
  sku = "",
  storeId = "",
  readProductSummary,
  readProductSkus,
} = {}) {
  const candidates = new Set([partnerSku, sku].map(normalizeSku).filter(Boolean));
  if (!candidates.size) return null;

  const repositories = await readPlatformRepositories(productsDir, "1688");
  for (const repository of repositories) {
    for (const productDir of repository.productDirs) {
      const productSkus = await readProductSkus(productDir.relativeDir, storeId);
      if (!productSkus.some((item) => candidates.has(normalizeSku(item)))) continue;
      return readProductSummary(productDir.relativeDir, repository.id, storeId);
    }
  }
  return null;
}

async function findRepository(productsDir, repositoryId) {
  const normalizedId = String(repositoryId || "").trim();
  if (!normalizedId) return null;
  const repositories = await readPlatformRepositories(productsDir, "1688");
  return repositories.find((repository) => repository.id === normalizedId) || null;
}

function normalizeSku(value) {
  return String(value || "").trim().toLowerCase();
}

function productMatchesQuery(product, q) {
  return [
    product.title,
    product.dirName,
    product.noonSummary?.title,
    product.noonSummary?.partnerSku,
  ].some((value) => String(value || "").toLowerCase().includes(q));
}

function productUploadStatus(product) {
  const status = product.noonUploadStatus || {};
  if (status.uploaded) return "uploaded";
  if (status.status === "uploading") return "uploading";
  if (status.status === "failed" || status.error) return "failed";
  return "not_uploaded";
}
