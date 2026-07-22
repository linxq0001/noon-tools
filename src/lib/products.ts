import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

type ProductDir = { relativeDir: string; fullPath: string };
type Repository = { id: string; name: string; productDirs: ProductDir[] };

export type RepositorySummary = {
  id: string;
  name: string;
  productCount: number;
  imageCount: number;
  uploadableCount: number;
  blockedCount: number;
  updatedAt: string;
};

export type ProductSummary = {
  dirName: string;
  repository: string;
  title: string;
  sourceUrl: string;
  price: unknown;
  imageCount: number;
  generatedAt: string;
  warnings: string[];
  coverImage: string;
  noonSummary: {
    title: string;
    variantCount: number;
    imageCount: number;
    partnerSku: string;
    hsCode: string;
    blockingCount: number;
  };
};

export type ProductDetail = {
  dirName: string;
  title: string;
  meta: Record<string, unknown> | null;
  product_group: Record<string, unknown>;
  variants: Array<Record<string, unknown>>;
  detailSource: "full_noon_attributes" | "missing_noon_attributes";
  dataNotice: string;
};

export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function productsRoot(rootDir = projectRoot()) {
  return path.join(rootDir, "products");
}

export async function listRepositorySummaries(rootDir = projectRoot()): Promise<RepositorySummary[]> {
  const repositories = await readPlatformRepositories(productsRoot(rootDir));
  const summaries = [];

  for (const repository of repositories) {
    const products = await Promise.all(repository.productDirs.map((productDir) => readProductSummary(productDir, repository.id)));
    summaries.push({
      id: repository.id,
      name: repository.name,
      productCount: products.length,
      imageCount: products.reduce((sum, product) => sum + product.imageCount, 0),
      uploadableCount: products.filter((product) => product.noonSummary.imageCount > 0).length,
      blockedCount: products.filter((product) => product.noonSummary.blockingCount > 0).length,
      updatedAt: products.map((product) => product.generatedAt).sort().at(-1) || "",
    });
  }

  return summaries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

export async function listRepositoryProducts({
  repositoryId,
  page = 1,
  pageSize = 20,
  q = "",
  rootDir = projectRoot(),
}: {
  repositoryId: string;
  page?: number;
  pageSize?: number;
  q?: string;
  rootDir?: string;
}) {
  const repositories = await readPlatformRepositories(productsRoot(rootDir));
  const repository = repositories.find((item) => item.id === repositoryId);
  if (!repository) return null;

  const query = q.trim().toLowerCase();
  const products = (await Promise.all(repository.productDirs.map((productDir) => readProductSummary(productDir, repository.id))))
    .filter((product) => !query || productMatchesQuery(product, query));
  const safePageSize = Math.min(100, Math.max(1, pageSize || 20));
  const totalItems = products.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / safePageSize));
  const currentPage = Math.min(Math.max(page || 1, 1), totalPages);
  const start = (currentPage - 1) * safePageSize;

  return {
    repository: {
      id: repository.id,
      name: repository.name,
      productCount: repository.productDirs.length,
    },
    products: products.slice(start, start + safePageSize),
    pagination: {
      page: currentPage,
      pageSize: safePageSize,
      totalItems,
      totalPages,
    },
  };
}

export async function readPlatformRepositories(productsDir: string): Promise<Repository[]> {
  const platformDir = path.join(productsDir, "1688");
  const repositories = [];

  for (const entry of await readDirectory(platformDir)) {
    if (!entry.isDirectory()) continue;
    const repositoryDir = path.join(platformDir, entry.name);
    const productDirs = await readDirectProductDirs(repositoryDir, `1688/${entry.name}`);
    if (!productDirs.length) continue;
    const metadata = await readJson(path.join(repositoryDir, "repository.json"));
    repositories.push({
      id: metadata?.id || entry.name,
      name: metadata?.name || (entry.name === "default" ? "默认仓库" : entry.name),
      productDirs,
    });
  }

  return repositories.sort((left, right) => left.id.localeCompare(right.id));
}

export async function readProductSummary(productDir: ProductDir, repository: string): Promise<ProductSummary> {
  const meta = await readJson(path.join(productDir.fullPath, "meta.json"));
  const noonAttributes = await readJson(path.join(productDir.fullPath, "noon-product-attributes.json"));
  const group = noonAttributes?.product_group && typeof noonAttributes.product_group === "object"
    ? noonAttributes.product_group as Record<string, unknown>
    : {};
  const variants = Array.isArray(noonAttributes?.variants) ? noonAttributes.variants : [];
  const firstVariant = variants[0] && typeof variants[0] === "object" ? variants[0] as Record<string, unknown> : {};
  const firstImage = Array.isArray(meta?.images) ? meta.images[0] : "";
  const coverImage = typeof firstImage === "string" ? firstImage : firstImage?.path || "";

  return {
    dirName: productDir.relativeDir,
    repository,
    title: meta?.title || path.basename(productDir.fullPath),
    sourceUrl: meta?.sourceUrl ?? meta?.source?.url ?? "",
    price: meta?.price ?? "",
    imageCount: Number(meta?.downloadedCount ?? meta?.images?.length ?? 0),
    generatedAt: meta?.generatedAt ?? meta?.collectedAt ?? "",
    warnings: Array.isArray(meta?.parseWarnings) ? meta.parseWarnings : [],
    coverImage: coverImage ? productFileUrl(productDir.relativeDir, coverImage) : "",
    noonSummary: {
      title: cleanText(group.product_group_name_en || noonAttributes?.title_en || noonAttributes?.product_title),
      variantCount: variants.length,
      imageCount: imageCount(meta, variants),
      partnerSku: cleanText(firstVariant.partner_sku),
      hsCode: cleanText(group.hs_code || firstVariant.hsCode || firstVariant.hs_code),
      blockingCount: noonAttributes ? 0 : 1,
    },
  };
}

export async function readProductDetail(relativeDir: string, rootDir = projectRoot()): Promise<ProductDetail | null> {
  const cleanRelativeDir = cleanProductRelativeDir(relativeDir);
  if (!cleanRelativeDir) return null;

  const productDir = path.resolve(productsRoot(rootDir), cleanRelativeDir);
  if (!productDir.startsWith(`${productsRoot(rootDir)}${path.sep}`)) return null;

  const meta = await readJson(path.join(productDir, "meta.json"));
  if (!meta) return null;

  const noonAttributes = await readJson(path.join(productDir, "noon-product-attributes.json"));
  const groupSource = noonAttributes?.product_group && typeof noonAttributes.product_group === "object"
    ? noonAttributes.product_group as Record<string, unknown>
    : {};
  const group: Record<string, unknown> = {
    ...groupSource,
    images: normalizeNoonImages(groupSource.images, cleanRelativeDir),
  };
  const variants = Array.isArray(noonAttributes?.variants)
    ? noonAttributes.variants.map((variant: unknown, index: number) => normalizeNoonVariant(variant, group, index, cleanRelativeDir))
    : [];

  return {
    dirName: cleanRelativeDir,
    title: String(group.product_group_name_en || group.title_en || meta.title || path.basename(cleanRelativeDir)),
    meta,
    product_group: group,
    variants,
    detailSource: noonAttributes ? "full_noon_attributes" : "missing_noon_attributes",
    dataNotice: noonAttributes
      ? "完整 Noon 属性：详情页直接读取 noon-product-attributes.json，避免列表摘要里的旧版本数据与新版本 product_group + variants 对不齐。"
      : "缺少 noon-product-attributes.json，当前只显示 1688 meta 数据。",
  };
}

async function readDirectProductDirs(dir: string, prefix: string): Promise<ProductDir[]> {
  const productDirs = [];
  for (const entry of await readDirectory(dir)) {
    if (!entry.isDirectory()) continue;
    const fullPath = path.join(dir, entry.name);
    if (!(await readJson(path.join(fullPath, "meta.json")))) continue;
    productDirs.push({ relativeDir: `${prefix}/${entry.name}`, fullPath });
  }
  return productDirs.sort((left, right) => left.relativeDir.localeCompare(right.relativeDir));
}

async function readDirectory(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function productFileUrl(relativeDir: string, filename: string) {
  return `/products/${[...relativeDir.split("/"), ...String(filename).split("/")].map(encodeURIComponent).join("/")}`;
}

function productMatchesQuery(product: ProductSummary, q: string) {
  return [product.title, product.dirName, product.noonSummary.title]
    .some((value) => String(value || "").toLowerCase().includes(q));
}

function imageCount(meta: Record<string, unknown> | null, variants: Array<Record<string, unknown>>) {
  const variantImageCount = Math.max(
    0,
    ...variants.map((variant) => (Array.isArray(variant.images) ? variant.images.length : 0)),
  );
  if (variantImageCount > 0) return variantImageCount;
  if (Array.isArray(meta?.images)) return meta.images.length;
  return Number(meta?.downloadedCount) || 0;
}

function cleanProductRelativeDir(value: string) {
  return String(value || "").replace(/^\/+|\/+$/g, "").split("/").filter(Boolean).map(decodePathSegment).join("/");
}

function cleanText(value: unknown) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function decodePathSegment(segment: string) {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

function normalizeNoonVariant(variant: unknown, group: Record<string, unknown>, index: number, relativeDir: string) {
  const source = variant && typeof variant === "object" ? variant as Record<string, unknown> : {};
  const rawImages = source.images ?? group.images ?? [];
  const images = normalizeNoonImages(rawImages, relativeDir);

  return {
    id: String(source.partner_sku || source.model_number || source.barcode || `variant-${index + 1}`),
    partnerSku: String(source.partner_sku || ""),
    modelNumber: String(source.model_number || ""),
    barcode: String(source.barcode || ""),
    title: String(source.title_en || group.product_group_name_en || ""),
    colour: String(source.colour_name || source.colour || ""),
    description: String(source.description_en || group.description_en || ""),
    bullets: Array.isArray(source.feature_bullets_en) ? source.feature_bullets_en.map(String) : [],
    priceSarInitial: source.price_sar_initial ?? group.price_sar_initial ?? "",
    priceUsd: source.price_usd ?? group.price_usd ?? "",
    stock: source.stock ?? group.stock ?? "",
    processingTime: String(source.processing_time || group.processing_time || ""),
    weightKg: source.actual_weight_kg ?? group.actual_weight_kg ?? "",
    sizeText: variantSizeText(source, group),
    images,
  };
}

function normalizeNoonImages(rawImages: unknown, relativeDir: string) {
  return (Array.isArray(rawImages) ? rawImages : [])
    .map((image) => {
      if (typeof image === "string") return image;
      if (image && typeof image === "object") return String((image as { url?: unknown; path?: unknown }).url || (image as { path?: unknown }).path || "");
      return "";
    })
    .filter(Boolean)
    .map((image) => normalizeProductImageUrl(relativeDir, image));
}

function normalizeProductImageUrl(relativeDir: string, image: string) {
  if (/^https?:\/\//i.test(image)) return image;
  return productFileUrl(relativeDir, image);
}

function variantSizeText(variant: Record<string, unknown>, group: Record<string, unknown>) {
  const values = ["length_cm", "width_cm", "height_cm"].map((field) => variant[field] ?? group[field]);
  return values.every((value) => value !== null && value !== undefined && String(value).trim() !== "") ? `${values.join(" x ")} cm` : "";
}
