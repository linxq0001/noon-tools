#!/usr/bin/env node

import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath, pathToFileURL } from "node:url";
import { detect1688AccessState } from "./lib/1688-access-state.js";
import { isLikelyDimensionImage, parseDimensionCandidates, resolveProductDimensions, selectDimensionVisionImages } from "./lib/dimension-extractor.js";
import { constrainNoonSelectValue } from "./lib/noon-field-constraints.js";
import { buildBasePartnerSku, buildPartnerBarcode } from "./lib/noon-product-identity.js";
import { normalizeNoonProductVariantImages } from "./lib/noon-product-normalizer.js";
import { ensureRepository, productStoragePath, rebuildProductIndexes, resolveRepositoryId } from "./lib/product-storage.js";
import { cleanProductTitle } from "./lib/title-cleaner.js";
import { assignImagesToVariants } from "./lib/variant-image-assignment.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const execFileAsync = promisify(execFile);
const templatePath = path.join(rootDir, "templates", "noon-product-attribute-template.json");
const productAttributeKeys = [
  "材质",
  "箱包形状",
  "开盖方式",
  "货号",
  "包内部结构",
  "风格",
  "外袋种类",
  "有可授权的自有品牌",
  "有无夹层",
  "箱包潮流款式",
  "里料质地",
  "硬度",
  "适用场景",
  "流行元素",
  "品牌",
  "颜色",
  "上市年份季节",
  "尺寸",
  "规格",
  "长宽高",
  "产品尺寸",
];

const args = parseArgs(process.argv.slice(2));
const template = JSON.parse(await readFile(templatePath, "utf8"));
let colourVisionConsecutiveFailures = 0;
let colourVisionDisabled = false;

if (args["from-meta"]) {
  await generateNoonProductFromMeta(args["from-meta"], { beautify: args.deepseek === "true" });
  process.exit(0);
}

const baseOutDir = path.resolve(rootDir, args.out ?? "products");
const limit = Number.parseInt(args.limit ?? "0", 10);
const effectiveLimit = Number.isFinite(limit) && limit > 0 ? limit : Number.MAX_SAFE_INTEGER;
const delaySeconds = Number.parseInt(args["delay-seconds"] ?? "30", 10);
const linksOnly = args["links-only"] === "true";
const fromQueue = args["from-queue"] === "true";
const listLimit = linksOnly ? Number.MAX_SAFE_INTEGER : effectiveLimit;
const listLinksOnly = linksOnly || !fromQueue;
const listPageDelayMinSeconds = 10;
const listPageDelayMaxSeconds = 30;
let outDir = path.join(baseOutDir, "1688", resolveRepositoryId(args.repository || ""));
let queuePath = path.join(outDir, "collection-queue.json");
let currentRepository = resolveRepositoryId(args.repository || "");

if (!args.url && linksOnly) {
  console.error(
    "Usage: npm run collect:1688 -- <1688-url> [--out products] [--limit 0] [--links-only true] [--delay-seconds 30] [--headless false] [--profile .cloak-profile] [--proxy http://user:pass@host:port] [--browser cloak|fetch] [--deepseek true]\n       npm run collect:1688 -- --from-queue true [--out products] [--limit 0] [--delay-seconds 30]\n       npm run collect:1688 -- --from-meta products/<product>/meta.json [--deepseek true]",
  );
  process.exit(1);
}

const browser = await createBrowser();

try {
  await mkdir(baseOutDir, { recursive: true });
  await setRepositoryOutputDir(args.repository || "");

  let productUrls = await readPendingQueue(effectiveLimit);

  if (!fromQueue && args.url && productUrls.length === 0) {
    const resolvedProductUrls = await resolveProductUrls(args.url, listLimit);
    await saveQueue(resolvedProductUrls, args.url);
    productUrls = linksOnly ? resolvedProductUrls : await readPendingQueue(effectiveLimit);
  }

  if (productUrls.length === 0) {
    const summary = await summarizeQueue();

    if (summary.completed > 0 || summary.skipped > 0) {
      logStep("queue", `没有待采集商品：已完成 ${summary.completed} 个，已跳过 ${summary.skipped} 个。`);
      logStep("queue", "如果要重新采集这些商品，请先清理对应仓库队列或删除本地商品目录。");
      process.exit(0);
    }

    throw new Error("No 1688 product detail links were found.");
  }

  if (linksOnly) {
    logStep("queue", `只收集链接，已写入队列: ${path.relative(rootDir, queuePath)}`);
  } else {
    let completedThisRun = 0;
    let skippedThisRun = 0;

    for (const [index, productUrl] of productUrls.entries()) {
      const productId = extractProductId(productUrl);

      if (productId && (await hasCollectedProduct(productId))) {
        logStep("skip", `已存在 meta.json，跳过: ${productId}`);
        await updateQueueItem(productUrl, "skipped", "Local meta.json already exists.");
        skippedThisRun += 1;
        continue;
      }

      if (index > 0 && delaySeconds > 0) {
        logStep("throttle", `等待 ${delaySeconds}s 后采集下一个详情页`);
        await sleep(delaySeconds * 1000);
      }

      try {
        await updateQueueItem(productUrl, "running", "");
        await collectProduct(productUrl);
        await updateQueueItem(productUrl, "completed", "");
        completedThisRun += 1;
      } catch (error) {
        await updateQueueItem(productUrl, "failed", error.message);
        throw error;
      }
    }

    await logQueueSummary({ completedThisRun, skippedThisRun, requestedLimit: effectiveLimit, selectedCount: productUrls.length });
  }
} finally {
  await browser.close();
}

async function resolveProductUrls(url, maxItems) {
  if (isProductDetailUrl(url)) return [url];

  logStep("list", `打开商品列表页: ${url}`);
  logStep("list", `商品数量上限: ${maxItems === Number.MAX_SAFE_INTEGER ? "不限" : maxItems}`);
  logStep("list", "采集页数: 自动识别页面实际总页数");
  let listTitle = "";
  let links = [];

  if (typeof browser.getProductLinks === "function") {
    const result = await browser.getProductLinks(url, maxItems);
    links = Array.isArray(result) ? result : result.links || [];
    listTitle = Array.isArray(result) ? "" : result.title || "";
  } else {
    const html = await browser.getHtml(url);
    links = extractProductLinks(html, url);
    listTitle = cleanTitle(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i));
  }

  await setRepositoryOutputDir(args.repository || buildRepositoryName(url, listTitle), { sourceListUrl: url });
  await mkdir(outDir, { recursive: true });
  logStep("repository", `仓库目录: ${path.relative(rootDir, outDir)}`);

  const productUrls = links.slice(0, maxItems);
  logStep("list", `找到商品详情链接: ${productUrls.length}`);
  logSample("list", productUrls);

  return productUrls;
}

async function setRepositoryOutputDir(name, options = {}) {
  const repository = resolveRepositoryId(name);
  currentRepository = repository;
  outDir = path.join(baseOutDir, "1688", repository);
  queuePath = path.join(outDir, "collection-queue.json");
  await ensureRepository(baseOutDir, {
    platform: "1688",
    repository,
    name: cleanTitle(name),
    sourceListUrl: options.sourceListUrl || "",
  });
}

function buildRepositoryName(url, title) {
  const cleanedTitle = cleanTitle(title)
    .replace(/\s*[-_]\s*1688.*$/i, "")
    .replace(/\s*-\s*阿里巴巴.*$/i, "");
  const hostName = (() => {
    try {
      return new URL(url).hostname.replace(/^www\./, "");
    } catch {
      return "1688-list";
    }
  })();
  const date = new Date().toISOString().slice(0, 10);

  return `${date}-${cleanedTitle || hostName}`;
}

async function saveQueue(productUrls, sourceUrl) {
  const queue = await readQueue();
  const now = new Date().toISOString();
  const itemsByProductId = new Map((queue.items || []).map((item) => [item.productId, item]));

  for (const url of productUrls) {
    const productId = extractProductId(url);
    if (!productId) continue;

    const current = itemsByProductId.get(productId);
    itemsByProductId.set(productId, {
      url,
      productId,
      status: current?.status && current.status !== "running" ? current.status : "pending",
      sourceListUrl: current?.sourceListUrl || sourceUrl || "",
      discoveredAt: current?.discoveredAt || now,
      lastTriedAt: current?.lastTriedAt || "",
      completedAt: current?.completedAt || "",
      error: current?.error || "",
    });
  }

  const nextQueue = {
    updatedAt: now,
    items: [...itemsByProductId.values()],
  };

  await writeJson(queuePath, nextQueue);
  logStep("queue", `队列商品数: ${nextQueue.items.length}`);
  logStep("queue", queueSummaryText(summarizeQueueItems(nextQueue.items)));
}

async function readPendingQueue(maxItems) {
  const queue = await readQueue();
  const urls = [];

  for (const item of queue.items || []) {
    if (item.status !== "pending" && item.status !== "failed") continue;
    if (item.productId && (await hasCollectedProduct(item.productId))) {
      await updateQueueItem(item.url, "skipped", "Local meta.json already exists.");
      continue;
    }

    urls.push(item.url);
    if (urls.length >= maxItems) break;
  }

  logStep("queue", `读取未完成队列: ${urls.length}`);
  if (maxItems !== Number.MAX_SAFE_INTEGER && urls.length >= maxItems) {
    logStep("queue", `本次最多处理 ${maxItems} 个商品，达到上限后会正常停止；要继续请再次点击“开始采集”。`);
  }
  logSample("queue", urls);

  return urls;
}

async function readQueue() {
  try {
    const queue = JSON.parse(await readFile(queuePath, "utf8"));
    return { items: Array.isArray(queue.items) ? queue.items : [] };
  } catch {
    return { items: [] };
  }
}

async function updateQueueItem(url, status, error) {
  const productId = extractProductId(url);
  if (!productId) return;

  const queue = await readQueue();
  const now = new Date().toISOString();
  const items = queue.items || [];
  const item = items.find((entry) => entry.productId === productId);

  if (!item) return;

  item.status = status;
  item.lastTriedAt = status === "running" ? now : item.lastTriedAt || now;
  item.completedAt = status === "completed" ? now : item.completedAt || "";
  item.error = error || "";

  await writeJson(queuePath, { updatedAt: now, items });
}

async function logQueueSummary({ completedThisRun, skippedThisRun, requestedLimit, selectedCount }) {
  const summary = await summarizeQueue();

  logStep("queue", `本批次完成: 成功采集 ${completedThisRun} 个，跳过 ${skippedThisRun} 个。`);

  if (requestedLimit !== Number.MAX_SAFE_INTEGER && selectedCount >= requestedLimit && (summary.pending > 0 || summary.failed > 0)) {
    logStep("queue", `本批次已达到商品数量上限 ${requestedLimit}，任务正常结束。`);
  }

  logStep(
    "queue",
    `队列剩余: pending=${summary.pending}, failed=${summary.failed}, completed=${summary.completed}, skipped=${summary.skipped}`,
  );

  if (summary.pending > 0 || summary.failed > 0) {
    logStep("queue", "还有未完成商品；下次直接点击“开始采集”即可继续。");
  }
}

async function summarizeQueue() {
  const queue = await readQueue();
  return summarizeQueueItems(queue.items || []);
}

function summarizeQueueItems(items) {
  const summary = { pending: 0, failed: 0, completed: 0, skipped: 0, running: 0 };

  for (const item of items) {
    if (summary[item.status] !== undefined) summary[item.status] += 1;
  }

  return summary;
}

function queueSummaryText(summary) {
  return `队列状态: pending=${summary.pending}, failed=${summary.failed}, completed=${summary.completed}, skipped=${summary.skipped}, running=${summary.running}`;
}

async function hasCollectedProduct(productId) {
  try {
    await readFile(path.join(outDir, productId, "meta.json"), "utf8");
    return true;
  } catch {}

  let entries = [];

  try {
    entries = await readdir(outDir, { withFileTypes: true });
  } catch {
    return false;
  }

  for (const entry of entries) {
    if (!entry.isDirectory() || !entry.name.startsWith(`${productId}-`)) continue;

    try {
      await readFile(path.join(outDir, entry.name, "meta.json"), "utf8");
      return true;
    } catch {}
  }

  return false;
}

async function collectProduct(url) {
  logStep("collect", `开始采集: ${url}`);
  const pageData = await browser.getProductPageData(url);
  const html = pageData.html;
  const productId = extractProductId(url) ?? shortHash(url);
  const meta = extractProductMeta(html, url, productId);

  logStep("collect", `商品ID: ${productId}`);
  logStep("title", `运行态标题: ${pageData.sourceTitle || "(空)"}`);
  logStep("title", `HTML标题兜底: ${meta.sourceTitle || "(空)"}`);
  meta.sourceTitle = cleanTitle(pageData.sourceTitle || meta.sourceTitle || meta.title);
  meta.attributes = pageData.attributes.length > 0 ? pageData.attributes : filterProductAttributes(meta.attributes);
  meta.packageInfo = pageData.packageInfo;
  meta.imageUrls = filterProductImageUrls(pageData.detailImageUrls);
  Object.assign(meta, buildListingTitle(meta.sourceTitle, meta.attributes));
  const productDir = productStoragePath(baseOutDir, {
    platform: "1688",
    repository: currentRepository,
    productId,
  });
  const imageDir = path.join(productDir, "images");

  logStep("title", `最终标题: ${meta.title || "(空)"}`);
  if (meta.productTypeText) logStep("title", `包型: ${meta.productTypeText}`);
  logStep("attributes", `属性数量: ${meta.attributes.length}`);
  logStep("package", `重量(g): ${meta.packageInfo.weightG || "(空)"}`);
  logStep("image-urls", `详情区原始图片URL数量: ${pageData.detailImageUrls.length}`);
  logStep("image-urls", `过滤后准备下载URL数量: ${meta.imageUrls.length}`);
  logSample("image-urls", meta.imageUrls, 5, "准备下载URL样例");

  meta.detailImageSelector =
    "#description > div > div.od-collapse-module > div.collapse-body > v-detail-*::shadow #detail img";
  meta.parseWarnings = buildWarnings({ title: meta.title, imageUrls: meta.imageUrls });

  await mkdir(imageDir, { recursive: true });
  await writeFile(path.join(productDir, "source.html"), html, "utf8");
  logStep("collect", `输出目录: ${path.relative(rootDir, productDir)}`);

  const downloads = await downloadImages(meta.imageUrls, imageDir, "images");
  meta.images = downloads.saved;
  meta.dimensions = resolveProductDimensions({ attributes: meta.attributes, packageInfo: meta.packageInfo });
  meta.generatedAt = new Date().toISOString();
  logStep("download", `准备下载URL数量: ${meta.imageUrls.length}`);
  logStep("download", `成功保存图片文件数: ${downloads.saved.length}`);
  logStep("download", `失败或跳过图片数: ${downloads.failed.length}`);
  for (const item of downloads.failed.slice(0, 10)) {
    logStep("download", `失败/跳过原因: ${item.reason} ${item.url}`);
  }

  meta.productDir = productDir;
  const noonProduct = normalizeNoonProductVariantImages(await buildNoonProduct(template.product, meta, { beautify: args.deepseek === "true" }));
  const outputMeta = buildOutputMeta(meta, downloads.failed);

  await writeJson(path.join(productDir, "meta.json"), outputMeta);
  await writeJson(path.join(productDir, "noon-product-attributes.json"), noonProduct);
  await rebuildProductIndexes(baseOutDir, "1688");

  console.log(`Collected ${meta.title || productId}`);
  console.log(`  ${path.relative(rootDir, productDir)}`);
}

async function generateNoonProductFromMeta(metaPath, options = {}) {
  const resolvedMetaPath = path.resolve(rootDir, metaPath);
  const productDir = path.dirname(resolvedMetaPath);
  const storedMeta = JSON.parse(await readFile(resolvedMetaPath, "utf8"));
  const meta = await normalizeStoredMetaForNoon(storedMeta, productDir);
  const noonProduct = normalizeNoonProductVariantImages(await buildNoonProduct(template.product, meta, options));
  const outputPath = path.join(productDir, "noon-product-attributes.json");

  await writeJson(outputPath, noonProduct);
  logStep("meta", `读取: ${path.relative(rootDir, resolvedMetaPath)}`);
  logStep("noon", `款式标题: ${noonProduct.product_group.product_group_name_en || "(空)"}`);
  logStep("noon", `颜色SKU数量: ${noonProduct.variants.length}`);
  logStep("noon", `首个SKU图片: ${noonProduct.variants[0]?.images.length ?? 0}`);
  logStep("noon", `重量(kg): ${noonProduct.variants[0]?.actual_weight_kg ?? "(空)"}`);
  logStep("noon", `输出: ${path.relative(rootDir, outputPath)}`);
}

async function normalizeStoredMetaForNoon(storedMeta, productDir) {
  const localImages = await listLocalImages(productDir);
  const productId = storedMeta.productId || extractProductId(storedMeta.sourceUrl || "") || path.basename(productDir);
  const priceValue = Number.parseFloat(storedMeta.price);
  const sourceHtml = await readFile(path.join(productDir, "source.html"), "utf8").catch(() => "");
  const sourceAttributes = sourceHtml ? extractAttributes(sourceHtml) : [];
  const sourcePackageInfo = sourceHtml ? extractPackageInfo(sourceHtml) : { weightG: "", dimensionsText: "" };
  const storedPackageInfo = storedMeta.packageInfo || {};
  const attributes = mergeAttributeLists(objectAttributesToList(storedMeta.attributes), sourceAttributes);

  return {
    source: {
      platform: "1688",
      url: storedMeta.sourceUrl || "",
      productId,
    },
    ...buildStoredTitle(storedMeta),
    sourceTitle: storedMeta.sourceTitle || storedMeta.title || "",
    description: storedMeta.description || "",
    price: Number.isFinite(priceValue)
      ? {
          value: priceValue,
          currency: "CNY",
          note: "1688 source price; convert manually before noon publishing.",
        }
      : null,
    packageInfo: {
      ...sourcePackageInfo,
      ...storedPackageInfo,
      dimensionsText: storedPackageInfo.dimensionsText || sourcePackageInfo.dimensionsText || "",
    },
    attributes,
    imageUrls: storedMeta.imageUrls || storedMeta.images || [],
    images: localImages.map((image) => ({ path: image })),
    dimensions: storedMeta.dimensions,
    productDir,
    parseWarnings: [],
  };
}

function mergeAttributeLists(primary, fallback) {
  const items = [];
  const seen = new Set();

  for (const attribute of [...primary, ...fallback]) {
    if (!attribute.name || seen.has(attribute.name)) continue;
    seen.add(attribute.name);
    items.push(attribute);
  }

  return items;
}

function buildStoredTitle(storedMeta) {
  const generated = buildListingTitle(storedMeta.sourceTitle || storedMeta.title || "", objectAttributesToList(storedMeta.attributes));

  return {
    ...generated,
    title: storedMeta.title || generated.title,
    titleParts: storedMeta.titleParts || generated.titleParts,
    productTypeText: storedMeta.productTypeText || generated.productTypeText,
  };
}

async function listLocalImages(productDir) {
  const imageDir = path.join(productDir, "images");
  const imageEntries = await readdir(imageDir).catch(() => []);
  if (imageEntries.length > 0) {
    return imageEntries
      .filter((entry) => /\.(?:jpe?g|png|webp|gif)$/i.test(entry))
      .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
      .map((entry) => `images/${entry}`);
  }

  const entries = await readdir(productDir);

  return entries
    .filter((entry) => /\.(?:jpe?g|png|webp|gif)$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }));
}

function objectAttributesToList(attributes) {
  if (Array.isArray(attributes)) return filterProductAttributes(attributes);
  return filterProductAttributes(Object.entries(attributes || {}).map(([name, value]) => ({ name, value })));
}

function extractProductMeta(html, url, productId) {
  const title = firstNonEmpty(
    readMeta(html, "og:title"),
    readJsonLikeValue(html, "subject"),
    readJsonLikeValue(html, "title"),
    cleanText(matchFirst(html, /<title[^>]*>([\s\S]*?)<\/title>/i)),
  );

  const description = firstNonEmpty(
    readMeta(html, "description"),
    readMeta(html, "og:description"),
    readJsonLikeValue(html, "description"),
  );

  const attributes = extractAttributes(html);
  const price = extractPrice(html);
  const packageInfo = extractPackageInfo(html);
  const imageUrls = [];

  return {
    source: {
      platform: "1688",
      url,
      productId,
    },
    title: normalizeTitle(title),
    sourceTitle: normalizeTitle(title),
    description: cleanText(description),
    price,
    packageInfo,
    attributes,
    imageUrls,
    images: [],
    parseWarnings: buildWarnings({ title, imageUrls }),
  };
}

function buildOutputMeta(meta, failedDownloads) {
  return {
    source: "1688",
    productId: meta.source.productId,
    attributes: Object.fromEntries(filterProductAttributes(meta.attributes).map((item) => [item.name, item.value])),
    imageUrls: meta.imageUrls,
    images: meta.images,
    packageInfo: meta.packageInfo,
    price: meta.price ? meta.price.value.toFixed(2) : "",
    sourceRoot: "shadow:#detail",
    sourceUrl: `https://detail.1688.com/offer/${meta.source.productId}.html`,
    sourceTitle: meta.sourceTitle,
    title: meta.title,
    status: meta.images.length >= 3 ? "ready" : "needs_review",
    collectedAt: new Date().toISOString(),
    titleParts: meta.titleParts || [],
    productTypeText: meta.productTypeText || "",
    dimensions: meta.dimensions,
    dimensionOcr: meta.dimensionOcr,
    dimensionVision: meta.dimensionVision,
    colourVision: meta.colourVision,
    imageAssignmentWarnings: meta.imageAssignmentWarnings || [],
    downloadedCount: meta.images.length,
    failedDownloads,
    blockingIssues: meta.images.length >= 3 ? [] : ["Less than 3 local images were downloaded."],
    warnings: [...(meta.parseWarnings || []), ...(meta.imageAssignmentWarnings || [])],
  };
}

async function buildNoonProduct(productTemplate, meta, options = {}) {
  const englishTitle = buildEnglishDraftTitle(meta.title);
  const attributeMap = Object.fromEntries(meta.attributes.map((item) => [item.name, item.value]));
  const sourceColours = splitValues(attributeMap["颜色"]);
  const material = constrainNoonSelectValue(
    "Exterior Material",
    safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["材质"])), "PU"),
    "PU",
  );
  const interiorMaterial = constrainNoonSelectValue(
    "Interior Material",
    safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["里料质地"])), "Polyester"),
    "Polyester",
  );
  const closure = constrainNoonSelectValue("Closure", translateClosure(firstValue(attributeMap["开盖方式"])), "Magnetic");
  const year = extractProductYear(meta.sourceTitle, attributeMap["上市年份季节"]);
  const productClass = inferProductClass(meta.sourceTitle, attributeMap);
  const groupName = safeEnglishValue(englishTitle || translateChinesePhrase(productClass), "Evening Bag");
  const groupNameAr = buildArabicProductName(groupName);
  const featureBullets = buildEnglishFeatureBullets(attributeMap, groupName);
  const featureBulletsAr = buildArabicFeatureBullets(featureBullets);
  const offerPrice = suggestedNoonPrice(meta.price);
  const longDescription = buildEnglishDescription({
    safeDescription: sanitizeNoonDescription(meta.description),
    groupName,
    attributeMap,
    material,
    closure,
  });
  const longDescriptionAr = buildArabicDescription({ groupNameAr, featureBulletsAr });
  const colours = sourceColours.length > 0 ? sourceColours : [""];
  const imageItems = meta.images.map((image) => image.path).filter(Boolean);
  const dimensions = await resolveDimensionsForNoon(meta, options);
  meta.dimensions = dimensions;
  const visualAssignments = await classifyColourImagesWithDeepSeek(meta, sourceColours, options);
  const imageAssignment = assignImagesToVariants({
    colours,
    images: meta.images,
    visualAssignments,
  });
  meta.imageAssignmentWarnings = imageAssignment.warnings;
  const generatedBarcodes = new Set();
  const variants = colours.map((sourceColour, index) => {
    const variantColour = stableNoonColour(sourceColour, `Colour ${index + 1}`);
    const variantColourName = stableNoonColourName(sourceColour, variantColour);
    const variantColourAr = translateEnglishToArabic(variantColour);
    const variantSku = buildBasePartnerSku({
      productId: meta.source.productId,
      variantIndex: index,
      colourCode: variantColourName || variantColour || sourceColour,
    });
    const variantTitle = [groupName, variantColour].filter(Boolean).join(", ");
    const variantTitleAr = [groupNameAr, variantColourAr].filter(Boolean).join("، ");
    const assignedImages = imageAssignment.imagesByColour[sourceColour || "_default"]?.map((image) => image.path).filter(Boolean) || imageItems;
    const barcode = buildPartnerBarcode({
      platform: "1688",
      productId: meta.source.productId,
      variantIndex: index,
      occupied: generatedBarcodes,
    });
    generatedBarcodes.add(barcode);

    return {
      partner_sku: variantSku,
      barcode,
      colour: variantColour,
      colour_name: variantColourName,
      title_en: variantTitle,
      title_ar: variantTitleAr,
      subtitle_en: groupName,
      subtitle_ar: groupNameAr,
      description_en: longDescription,
      description_ar: longDescriptionAr,
      feature_bullets_en: featureBullets,
      feature_bullets_ar: featureBulletsAr,
      model_number: variantSku,
      length_cm: dimensions.lengthCm,
      width_cm: dimensions.widthCm,
      height_cm: dimensions.heightCm,
      actual_weight_kg: suggestedNoonWeightKg(meta.packageInfo.weightG),
      vm_weight_cm: null,
      price_sar_initial: offerPrice,
      price_usd: null,
      stock: 0,
      processing_time: "2_days",
      warehouse_name: productTemplate.upload_config?.warehouse_name || "China NGS Test Warehouse",
      warehouse_code: productTemplate.upload_config?.warehouse_code || "W00183886CN",
      images: assignedImages,
    };
  });

  const noonProduct = {
    product_group: {
      product_group_name_en: groupName,
      product_group_name_ar: groupNameAr,
      category: "Bags & Luggage > Handbag > Clutch",
      brand: "No Brand",
      gender: constrainNoonSelectValue("Gender", "Women", "Women"),
      hs_code: "420222",
      country_of_origin: "China",
      model_name: buildModelName(groupName, meta),
      exterior_material: material,
      interior_material: interiorMaterial,
      material_composition: [material, hasRhinestone(meta) ? "Rhinestone" : ""].filter(Boolean).join(", "),
      occasion: constrainNoonSelectValue("Occasion", "Party", "Party"),
      size: "One Size",
      size_unit: constrainNoonSelectValue("Size Unit", "cm", "cm"),
      year: String(Math.max(year, 2026)),
      features: buildDetailedFeatures(meta),
      care_instructions: constrainNoonSelectValue("Care Instructions", "Wipe clean with a dry cloth", "Spot Clean"),
      casing: constrainNoonSelectValue("Casing", "Hard Case", "Hardside"),
      closure,
      type: constrainNoonSelectValue("Type", "Clutch", "Envelope"),
      strap_material: constrainNoonSelectValue("Strap Material", material || "PU", "PU"),
      item_condition: constrainNoonSelectValue("Item Condition", "New", "New"),
      what_is_in_the_box: "1 x Evening Clutch Bag",
      variation_axis: "Colour Name",
    },
    variants,
    upload_config: productTemplate.upload_config || defaultUploadConfig(),
    submission_gate: buildSubmissionGate({
      englishTitle: groupName,
      featureBullets,
      longDescription,
      meta,
      offerPrice,
      sourceColours,
    }),
  };

  if (options.beautify) {
    await applyDeepSeekBeautification(noonProduct, meta);
  }

  hoistCommonVariantFields(noonProduct);

  return noonProduct;
}

async function applyDeepSeekBeautification(noonProduct, meta) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

  if (!apiKey) {
    logStep("deepseek", "未设置 DEEPSEEK_API_KEY，跳过 AI 美化，保留规则生成结果。");
    noonProduct.ai_generation = {
      provider: "deepseek",
      model,
      generated_at: new Date().toISOString(),
      status: "skipped",
      error: "DEEPSEEK_API_KEY is not set.",
      fallback: "rule_based_noon_product_kept",
    };
    return;
  }

  logStep("deepseek", `调用模型: ${model}`);

  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      temperature: 0.35,
      response_format: { type: "json_object" },
      messages: [
        {
          role: "system",
          content:
            "You write marketplace-safe noon product content for women's evening clutch bags. Return only valid JSON. Do not include wholesale, supplier, shipping, 1688, factory, MOQ, refund, delivery, or sourcing text.",
        },
        {
          role: "user",
          content: JSON.stringify(buildDeepSeekBeautifyInput(noonProduct, meta)),
        },
      ],
    }),
  });

  const data = await response.json().catch(() => null);

  if (!response.ok) {
    const errorMessage = `DeepSeek API failed: HTTP ${response.status} ${JSON.stringify(data)}`;
    logStep("deepseek", errorMessage);
    noonProduct.ai_generation = {
      provider: "deepseek",
      model,
      generated_at: new Date().toISOString(),
      status: "failed",
      error: errorMessage,
      fallback: "rule_based_noon_product_kept",
    };
    return;
  }

  const content = data?.choices?.[0]?.message?.content;
  let patch;

  try {
    patch = parseAiJson(content);
  } catch (error) {
    logStep("deepseek", `DeepSeek JSON 解析失败: ${error.message}`);
    noonProduct.ai_generation = {
      provider: "deepseek",
      model,
      generated_at: new Date().toISOString(),
      status: "failed",
      error: error.message,
      fallback: "rule_based_noon_product_kept",
    };
    return;
  }

  applyAiCopyPatch(noonProduct, patch);
  noonProduct.ai_generation = {
    provider: "deepseek",
    model,
    generated_at: new Date().toISOString(),
    status: "completed",
    scope: "title_description_bullets_only",
  };
  logStep("deepseek", "已完成标题、描述、卖点美化。");
}

async function classifyColourImagesWithDeepSeek(meta, sourceColours, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const colours = sourceColours.filter(Boolean);

  if (!options.beautify || !apiKey || colours.length < 2 || colourVisionDisabled) return [];
  if (!isDeepSeekImageVisionEnabled()) return [];

  const candidates = meta.images
    .filter((image) => image.path && !isLikelyDimensionImage(image))
    .slice(0, 6);

  if (candidates.length === 0) return [];

  const startedAt = Date.now();

  try {
    const imageMessages = [];

    for (const image of candidates) {
      const imagePath = path.join(meta.productDir, image.path);
      const { bytes, mimeType } = await readVisionImage(imagePath, image.contentType || mimeTypeFromImagePath(image.path));

      imageMessages.push({ type: "text", text: `Image ${image.path}` });
      imageMessages.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` },
      });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Assign each product image to one existing colour or _shared. Return only valid JSON.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  task: "Assign each image to one of the allowed colours or _shared. Do not create new colours.",
                  allowedColours: colours,
                  outputSchema: {
                    imageAssignments: [{ image: "001.jpg", assignedColour: "金色|_shared", confidence: "high|medium|low", reason: "short" }],
                  },
                }),
              },
              ...imageMessages,
            ],
          },
        ],
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(data)}`);

    const patch = parseAiJson(data?.choices?.[0]?.message?.content);
    const assignments = sanitizeColourAssignments(patch.imageAssignments, candidates, colours);

    if (assignments.length === 0) throw new Error("DeepSeek vision returned no usable colour assignments.");

    colourVisionConsecutiveFailures = 0;
    meta.colourVision = {
      provider: "deepseek",
      model,
      status: "completed",
      imageAssignments: assignments,
      elapsedMs: Date.now() - startedAt,
    };
    logStep(
      "colour-vision",
      `识别 ${candidates.length} 张图片，分配到 ${new Set(assignments.map((item) => item.assignedColour)).size} 个颜色，耗时 ${((Date.now() - startedAt) / 1000).toFixed(1)}s`,
    );

    return assignments;
  } catch (error) {
    colourVisionConsecutiveFailures += 1;
    meta.colourVision = {
      provider: "deepseek",
      model,
      status: "failed",
      error: error.message,
      consecutiveFailures: colourVisionConsecutiveFailures,
    };
    logStep("colour-vision", `DeepSeek vision failed: ${error.message}; using shared images fallback.`);

    if (colourVisionConsecutiveFailures >= 3) {
      colourVisionDisabled = true;
      logStep("colour-vision", "连续 3 个商品视觉识别失败，本轮关闭颜色图片区分，后续商品使用 shared 图片。");
    }

    return [];
  }
}

async function resolveDimensionsForNoon(meta, options = {}) {
  if (meta.dimensions && meta.dimensions.source !== "default") return meta.dimensions;

  const fromAttributes = resolveProductDimensions({ attributes: meta.attributes, packageInfo: meta.packageInfo });

  if (fromAttributes.source !== "default") return fromAttributes;

  const ocrDimensions = await classifyDimensionsWithOcr(meta);
  if (ocrDimensions) return ocrDimensions;

  const imageDimensions = await classifyDimensionsWithDeepSeek(meta, options);
  if (imageDimensions) return imageDimensions;

  return fromAttributes;
}

async function classifyDimensionsWithOcr(meta) {
  const candidates = (Array.isArray(meta.images) ? meta.images : []).filter((image) => image?.path).reverse();

  if (candidates.length === 0) return null;

  const attemptedImages = [];
  let ocrResults = [];

  try {
    ocrResults = await readDimensionOcrResults(candidates.map((image) => path.join(meta.productDir, image.path)));
  } catch (error) {
    meta.dimensionOcr = {
      provider: "paddleocr",
      status: "failed",
      attemptedImages: candidates.map((image) => image.path),
      error: error.message,
    };
    logStep("dimension-ocr", `本地 OCR 失败: ${error.message}`);
    return null;
  }

  for (const [index, image] of candidates.entries()) {
    const text = ocrResults[index]?.text || "";
    attemptedImages.push(image.path);
    const imageCandidates = parseDimensionCandidates(text, "image_ocr", image.path);

    meta.dimensionOcr = {
      provider: "paddleocr",
      status: imageCandidates.length > 0 ? "completed" : "no_dimensions",
      image: image.path,
      attemptedImages,
      text: cleanText(text).slice(0, 500),
    };

    if (imageCandidates.length === 0) {
      logStep("dimension-ocr", `未从 ${image.path} 直接 OCR 到完整尺寸，继续检查上一张。`);
      continue;
    }

    const result = resolveProductDimensions({ imageCandidates });
    meta.dimensionVision = {
      provider: "paddleocr",
      status: "completed",
      image: image.path,
      evidence: imageCandidates[0].evidence,
    };
    logStep("dimension-ocr", `从 ${image.path} OCR识别尺寸: ${result.lengthCm} x ${result.widthCm} x ${result.heightCm} cm`);
    return result;
  }

  meta.dimensionOcr = {
    provider: "paddleocr",
    status: "no_dimensions",
    attemptedImages,
  };
  logStep("dimension-ocr", `已倒序检查 ${attemptedImages.length} 张图片，未 OCR 到完整尺寸。`);
  return null;
}

async function readDimensionOcrText(imagePath) {
  const [result] = await readDimensionOcrResults([imagePath]);
  return result?.text || "";
}

async function readDimensionOcrResults(imagePaths) {
  const python = await resolvePaddleOcrPython();
  const scriptPath = path.join(rootDir, "scripts", "paddle-ocr-image.py");
  const { stdout } = await execFileAsync(python, [scriptPath, ...imagePaths], {
    cwd: rootDir,
    env: {
      ...process.env,
      PADDLEOCR_HOME: process.env.PADDLEOCR_HOME || path.join(rootDir, ".cache", "paddleocr"),
    },
    timeout: 240000,
    maxBuffer: 1024 * 1024 * 8,
  });
  const data = JSON.parse(stdout);

  if (!data.ok) throw new Error(data.error || "PaddleOCR failed.");
  if (Array.isArray(data.results)) {
    return data.results.map((result) => ({
      imagePath: result.imagePath || "",
      text: Array.isArray(result.texts) ? result.texts.join("\n") : "",
    }));
  }

  return [{ imagePath: imagePaths[0] || "", text: Array.isArray(data.texts) ? data.texts.join("\n") : "" }];
}

async function resolvePaddleOcrPython() {
  if (process.env.PADDLEOCR_PYTHON) return process.env.PADDLEOCR_PYTHON;

  const venvPython = path.join(rootDir, ".venv-paddleocr", "bin", "python");
  try {
    await execFileAsync(venvPython, ["--version"], { timeout: 5000 });
    return venvPython;
  } catch {
    // Fall back to PATH interpreters.
  }

  for (const python of ["python3.11", "python3.10", "python3"]) {
    try {
      await execFileAsync(python, ["--version"], { timeout: 5000 });
      return python;
    } catch {
      // Try the next interpreter.
    }
  }

  return "python3";
}

async function classifyDimensionsWithDeepSeek(meta, options = {}) {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL || "deepseek-v4-flash";
  const baseUrl = (process.env.DEEPSEEK_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");

  if (!options.beautify || !apiKey) return null;
  if (!isDeepSeekImageVisionEnabled()) return null;

  const candidates = selectDimensionVisionImages(meta.images);

  if (candidates.length === 0) return null;

  try {
    const imageMessages = [];

    for (const image of candidates) {
      const imagePath = path.join(meta.productDir, image.path);
      const { bytes, mimeType } = await readVisionImage(imagePath, image.contentType || mimeTypeFromImagePath(image.path));

      imageMessages.push({ type: "text", text: `Image ${image.path}` });
      imageMessages.push({
        type: "image_url",
        image_url: { url: `data:${mimeType};base64,${Buffer.from(bytes).toString("base64")}` },
      });
    }

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: "Read product dimension labels from images. Return only valid JSON.",
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: JSON.stringify({
                  task: "Find handbag dimensions from size chart images only. Do not estimate from models, hands, or background scale.",
                  dimensionOrder: "When an unlabelled triple appears, treat it as length x width x height.",
                  labelMapping: "If the image uses Chinese labels 宽度/高度/厚度, map 宽度 to lengthCm, 厚度 to widthCm, and 高度 to heightCm.",
                  outputSchema: {
                    hasDimensions: true,
                    lengthCm: 17,
                    widthCm: 6,
                    heightCm: 15,
                    thicknessCm: 6,
                    confidence: "high|medium|low",
                    evidence: "17 x 6 x 15 cm",
                    image: "003.jpg",
                  },
                }),
              },
              ...imageMessages,
            ],
          },
        ],
      }),
    });
    const data = await response.json().catch(() => null);

    if (!response.ok) throw new Error(`HTTP ${response.status} ${JSON.stringify(data)}`);

    const patch = parseAiJson(data?.choices?.[0]?.message?.content);
    if (!patch.hasDimensions) return null;

    let lengthCm = Number(patch.lengthCm);
    let widthCm = Number(patch.widthCm);
    const heightCm = Number(patch.heightCm);
    const thicknessCm = Number(patch.thicknessCm ?? patch.depthCm);

    if (!Number.isFinite(lengthCm) && Number.isFinite(widthCm) && Number.isFinite(thicknessCm)) {
      lengthCm = widthCm;
      widthCm = thicknessCm;
    }

    if (![lengthCm, widthCm, heightCm].every((value) => Number.isFinite(value) && value > 0)) return null;

    meta.dimensionVision = {
      provider: "deepseek",
      model,
      status: "completed",
      confidence: cleanText(patch.confidence),
      evidence: cleanText(patch.evidence),
      image: cleanText(patch.image),
    };
    logStep("dimension-vision", `图片识别尺寸: ${lengthCm} x ${widthCm} x ${heightCm} cm`);

    return {
      lengthCm,
      widthCm,
      heightCm,
      source: "image_vision",
      candidates: [
        {
          lengthCm,
          widthCm,
          heightCm,
          source: "image_vision",
          image: cleanText(patch.image),
          evidence: cleanText(patch.evidence),
        },
      ],
      warnings: [],
    };
  } catch (error) {
    meta.dimensionVision = {
      provider: "deepseek",
      model,
      status: "failed",
      error: error.message,
    };
    logStep("dimension-vision", `DeepSeek dimension vision failed: ${error.message}; using default dimensions fallback.`);
    return null;
  }
}

function isDeepSeekImageVisionEnabled() {
  return process.env.DEEPSEEK_ENABLE_IMAGE_VISION === "true";
}

function sanitizeColourAssignments(items, candidates, colours) {
  const allowedImages = new Set(candidates.map((image) => image.path));
  const allowedColours = new Set([...colours, "_shared"]);
  const output = [];

  for (const item of Array.isArray(items) ? items : []) {
    const image = cleanText(item.image || item.path);
    const assignedColour = cleanText(item.assignedColour);

    if (!allowedImages.has(image) || !allowedColours.has(assignedColour)) continue;
    output.push({
      path: image,
      assignedColour,
      confidence: cleanText(item.confidence),
      reason: cleanText(item.reason).slice(0, 160),
    });
  }

  return output;
}

async function readVisionImage(imagePath, fallbackMimeType) {
  const tempDir = await mkdtemp(path.join(tmpdir(), "noon-vision-"));
  const outputPath = path.join(tempDir, "image.jpg");

  try {
    await execFileAsync("/usr/bin/sips", ["-Z", "768", "-s", "format", "jpeg", imagePath, "--out", outputPath], { timeout: 10000 });
    return {
      bytes: await readFile(outputPath),
      mimeType: "image/jpeg",
    };
  } catch {
    return {
      bytes: await readFile(imagePath),
      mimeType: fallbackMimeType,
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

function mimeTypeFromImagePath(imagePath) {
  if (/\.png$/i.test(imagePath)) return "image/png";
  if (/\.webp$/i.test(imagePath)) return "image/webp";
  if (/\.gif$/i.test(imagePath)) return "image/gif";
  return "image/jpeg";
}

function buildDeepSeekBeautifyInput(noonProduct, meta) {
  return {
    task:
      "Improve only the marketplace copy for a women's evening clutch product. Use the cleaned bag type and style signals to make polished English and Arabic content. Keep one variant per source colour. Do not change SKU, barcode, price, stock, colour fields, images, dimensions, weight, category, materials, warehouse, or upload_config.",
    output_schema: {
      product_group_name_en: "string",
      product_group_name_ar: "Arabic string",
      model_name: "string",
      variants: [
        {
          index: "number",
          title_en: "string",
          title_ar: "Arabic string",
          subtitle_en: "string",
          subtitle_ar: "Arabic string",
          description_en: "80-130 words",
          description_ar: "Arabic description",
          feature_bullets_en: "array of 5 strings",
          feature_bullets_ar: "array of 5 Arabic strings",
        },
      ],
    },
    rules: [
      "English title format: core material or decoration + occasion/style + main bag type + key carry structure. Keep it around 70 characters and avoid stacking more than two bag types.",
      "Arabic title must be natural Arabic marketplace copy and match the English title meaning without word-for-word translation.",
      "Use enhanced but truthful selling copy for dinners, parties, weddings, and formal occasions.",
      "Do not invent waterproofing, scratch resistance, genuine leather, pure silver, real diamonds, luxury branding, adjustable chain, large capacity, or phone compatibility.",
      "Description must describe product features and occasions only.",
      "Do not mention 1688, Alibaba, wholesale, factory, stock, delivery, refund, shipping, MOQ, cross-border sourcing, or supplier service text.",
      "Do not promise branded goods. Use Generic positioning.",
      "Feature bullets should be concrete and based on source attributes.",
    ],
    source_meta: {
      productId: meta.source.productId,
      sourceTitle: meta.sourceTitle,
      extractedTitle: meta.title,
      titleParts: meta.titleParts || [],
      productTypeText: meta.productTypeText || "",
      attributes: Object.fromEntries(meta.attributes.map((item) => [item.name, item.value])),
      packageInfo: meta.packageInfo,
      dimensions: meta.dimensions,
    },
    current_noon_product: {
      product_group: noonProduct.product_group,
      variants: noonProduct.variants.map((variant, index) => ({
        index,
        colour: variant.colour,
        colour_name: variant.colour_name,
        title_en: variant.title_en,
        title_ar: variant.title_ar,
        subtitle_en: variant.subtitle_en,
        subtitle_ar: variant.subtitle_ar,
        description_en: variant.description_en,
        description_ar: variant.description_ar,
        feature_bullets_en: variant.feature_bullets_en,
        feature_bullets_ar: variant.feature_bullets_ar,
      })),
    },
  };
}

function parseAiJson(content) {
  const text = cleanText(content);
  const jsonText = text.startsWith("{") ? text : text.match(/\{[\s\S]*\}/)?.[0];

  if (!jsonText) throw new Error("DeepSeek response did not contain JSON.");
  return JSON.parse(jsonText);
}

function applyAiCopyPatch(noonProduct, patch) {
  if (isSafeEnglishCopy(patch.product_group_name_en)) {
    noonProduct.product_group.product_group_name_en = cleanText(patch.product_group_name_en);
  }
  if (isSafeArabicCopy(patch.product_group_name_ar)) {
    noonProduct.product_group.product_group_name_ar = cleanText(patch.product_group_name_ar);
  }
  if (isSafeEnglishCopy(patch.model_name)) {
    noonProduct.product_group.model_name = cleanText(patch.model_name);
  }

  for (const item of Array.isArray(patch.variants) ? patch.variants : []) {
    const index = Number.parseInt(item.index, 10);
    const variant = noonProduct.variants[index];

    if (!variant) continue;
    if (isSafeEnglishCopy(item.title_en)) variant.title_en = cleanText(item.title_en);
    if (isSafeArabicCopy(item.title_ar)) variant.title_ar = cleanText(item.title_ar);
    if (isSafeEnglishCopy(item.subtitle_en)) variant.subtitle_en = cleanText(item.subtitle_en);
    if (isSafeArabicCopy(item.subtitle_ar)) variant.subtitle_ar = cleanText(item.subtitle_ar);
    if (isSafeEnglishCopy(item.description_en)) variant.description_en = cleanText(item.description_en);
    if (isSafeArabicCopy(item.description_ar)) variant.description_ar = cleanText(item.description_ar);
    if (Array.isArray(item.feature_bullets_en)) {
      const bullets = item.feature_bullets_en.map(cleanText).filter(isSafeEnglishCopy).slice(0, 5);
      if (bullets.length > 0) variant.feature_bullets_en = bullets;
    }
    if (Array.isArray(item.feature_bullets_ar)) {
      const bullets = item.feature_bullets_ar.map(cleanText).filter(isSafeArabicCopy).slice(0, 5);
      if (bullets.length > 0) variant.feature_bullets_ar = bullets;
    }
  }
}

function isSafeEnglishCopy(value) {
  const text = cleanText(value);
  return Boolean(text) && !containsChinese(text) && !hasBlockedMarketplaceText(text);
}

function isSafeArabicCopy(value) {
  const text = cleanText(value);
  return Boolean(text) && /[\u0600-\u06ff]/.test(text) && !containsChinese(text) && !hasBlockedMarketplaceText(text);
}

function hasBlockedMarketplaceText(value) {
  return /1688|Alibaba|阿里巴巴|wholesale|factory|supplier|MOQ|shipping|delivery|refund|return|stock|sourcing|批发|厂家|供应商|起批|发货|运费|退款|退货|库存/i.test(
    value,
  );
}

async function downloadImages(urls, imageDir, relativeDir = "") {
  const saved = [];
  const failed = [];

  for (const [index, url] of urls.entries()) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": browser.userAgent,
          referer: "https://detail.1688.com/",
        },
      });

      if (!response.ok) {
        failed.push({ url, reason: `HTTP ${response.status}` });
        continue;
      }

      const contentType = response.headers.get("content-type") ?? "";
      const bytes = new Uint8Array(await response.arrayBuffer());
      const dimensions = imageDimensions(bytes);

      if (!dimensions || dimensions.width < 300 || dimensions.height < 300) {
        failed.push({
          url,
          reason: dimensions ? `Skipped small image ${dimensions.width}x${dimensions.height}` : "Skipped unknown image size",
        });
        continue;
      }

      const filename = `${String(saved.length + 1).padStart(3, "0")}${imageExtensionFromResponse(url, contentType)}`;
      await writeFile(path.join(imageDir, filename), bytes);

      saved.push({
        sourceUrl: url,
        path: relativeDir ? `${relativeDir}/${filename}` : filename,
        contentType,
        width: dimensions.width,
        height: dimensions.height,
      });
    } catch (error) {
      failed.push({ url, reason: error.message });
    }
  }

  return { saved, failed };
}

function imageDimensions(bytes) {
  if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return {
      width: bytes[6] | (bytes[7] << 8),
      height: bytes[8] | (bytes[9] << 8),
    };
  }

  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return {
      width: readUInt32(bytes, 16),
      height: readUInt32(bytes, 20),
    };
  }

  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;

    while (offset < bytes.length) {
      if (bytes[offset] !== 0xff) return null;

      const marker = bytes[offset + 1];
      const length = (bytes[offset + 2] << 8) + bytes[offset + 3];

      if (marker >= 0xc0 && marker <= 0xc3) {
        return {
          height: (bytes[offset + 5] << 8) + bytes[offset + 6],
          width: (bytes[offset + 7] << 8) + bytes[offset + 8],
        };
      }

      offset += 2 + length;
    }
  }

  if (String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") {
    const chunk = String.fromCharCode(...bytes.slice(12, 16));

    if (chunk === "VP8X") {
      return {
        width: 1 + bytes[24] + (bytes[25] << 8) + (bytes[26] << 16),
        height: 1 + bytes[27] + (bytes[28] << 8) + (bytes[29] << 16),
      };
    }
  }

  return null;
}

function readUInt32(bytes, offset) {
  return ((bytes[offset] << 24) | (bytes[offset + 1] << 16) | (bytes[offset + 2] << 8) | bytes[offset + 3]) >>> 0;
}

function imageExtensionFromResponse(url, contentType) {
  if (contentType.includes("gif") || /\.gif(?:$|[?_])/i.test(url)) return ".gif";
  return ".jpg";
}

async function createBrowser() {
  const userAgent =
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125.0.0.0 Safari/537.36";

  if (args.browser === "fetch") {
    return {
      userAgent,
      async getHtml(url) {
        const response = await fetch(url, { headers: { "user-agent": userAgent } });
        if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
        return response.text();
      },
      async getProductPageData(url) {
        const html = await this.getHtml(url);
        return {
          html,
          detailImageUrls: [],
          attributes: [],
          packageInfo: { weightG: "", dimensionsText: "" },
          sourceTitle: "",
        };
      },
      async close() {},
    };
  }

  const { launchPersistentContext } = await importCloakBrowser();
  let context;

  try {
    context = await launchPersistentContext({
      userDataDir: path.resolve(rootDir, args.profile ?? ".cloakbrowser-profile"),
      headless: args.headless !== "false",
      proxy: args.proxy,
      locale: "zh-CN",
      timezone: "Asia/Shanghai",
      userAgent,
      viewport: { width: 1365, height: 900 },
      humanize: true,
      humanPreset: "careful",
    });
  } catch (error) {
    if (/existing browser session|has been closed|launchPersistentContext/i.test(error.message)) {
      throw new Error("CloakBrowser Profile 正在被另一个窗口使用。请先关闭“登录1688”窗口或其它使用 .cloakbrowser-profile 的 Chromium 窗口，再开始采集。");
    }

    throw error;
  }

  return {
    userAgent,
    async getHtml(url) {
      const page = context.pages()[0] ?? (await context.newPage());

      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      await sleep(3000);
      return page.content();
    },
    async getProductLinks(url, maxItems) {
      const page = context.pages()[0] ?? (await context.newPage());

      logStep("list", "使用 CloakBrowser 解析列表页");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      logStep("list", `当前URL: ${page.url()}`);
      logStep("list", `页面标题: ${await page.title()}`);
      await waitForLoginIfNeeded(page, url, "list");
      await sleep(2500);
      await waitForLoginIfNeeded(page, url, "list");

      const productLinks = [];
      const seenProductIds = new Set();
      const initialPagination = await readOfferListPagination(page);
      const effectivePageLimit = initialPagination.total || 1;

      if (initialPagination.total) {
        logStep("list", `页面实际总页数: ${initialPagination.total}`);
      } else {
        logStep("list", "未识别到分页信息，改用滚动方式解析列表");
      }

      for (let pageIndex = 1; pageIndex <= effectivePageLimit && productLinks.length < maxItems; pageIndex += 1) {
        const currentPagination = await readOfferListPagination(page);
        const currentPage = currentPagination.current || pageIndex;

        logStep("list", `开始解析第 ${currentPage} 页`);
        await collectScrollingOfferListLinks(page, productLinks, seenProductIds, maxItems, `第 ${currentPage} 页`);

        if (listLinksOnly) {
          logStep("list", "采集链接阶段：不点击商品卡片，避免打开详情页");
        } else if (productLinks.length < maxItems) {
          await collectCardPopupLinks(page, productLinks, seenProductIds, maxItems, currentPage);
          logStep("list", `第 ${currentPage} 页点击兜底后累计: ${productLinks.length}`);
        }

        if (productLinks.length >= maxItems || pageIndex >= effectivePageLimit) break;

        const pageDelaySeconds = randomInt(listPageDelayMinSeconds, listPageDelayMaxSeconds);
        logStep("throttle", `翻页前随机等待 ${pageDelaySeconds}s，降低列表页风控概率`);
        await sleep(pageDelaySeconds * 1000);

        const moved = await clickNextOfferListPage(page, currentPage);
        if (!moved) {
          logStep("list", "没有进入新的下一页，停止翻页");
          break;
        }

        logStep("list", `进入第 ${moved.current || pageIndex + 1} 页`);
      }

      if (productLinks.length === 0) {
        await waitForLoginIfNeeded(page, url, "list");
      }

      return { links: productLinks, title: await page.title() };
    },
    async getProductPageData(url) {
      const page = context.pages()[0] ?? (await context.newPage());

      logStep("browser", "打开 CloakBrowser 页面");
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
      logStep("browser", `当前URL: ${page.url()}`);
      logStep("browser", `页面标题: ${await page.title()}`);
      await waitForLoginIfNeeded(page, url, "detail");
      await page.waitForSelector("#description", { state: "attached", timeout: 60000 });
      logStep("detail", "找到 #description");
      await openProductDetailSection(page);
      const detailData = await waitForDetailData(page);
      const html = await page.content();

      return {
        html,
        detailImageUrls: detailData.imageUrls,
        attributes: detailData.attributes,
        packageInfo: detailData.packageInfo,
        sourceTitle: detailData.sourceTitle,
      };
    },
    async close() {
      await context.close();
    },
  };
}

async function importCloakBrowser() {
  try {
    return await import("cloakbrowser");
  } catch (error) {
    const globalEntry = "/opt/homebrew/lib/node_modules/cloakbrowser/dist/index.js";

    try {
      return await import(pathToFileURL(globalEntry).href);
    } catch {
      throw error;
    }
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

async function waitForLoginIfNeeded(page, originalUrl, scope) {
  const loginState = await detectLoginPage(page);

  if (!loginState.isLoginPage) return;

  logStep(scope, `${loginState.message}: ${loginState.url}`);

  if (loginState.reason === "navigation_error") {
    throw new Error(`${loginState.message} 当前页面是 ${loginState.url}，不是登录页。请重试该商品链接，或确认网络/代理/CloakBrowser 可打开 1688 详情页。`);
  }

  if (args.headless !== "false") {
    throw new Error(`${loginState.message} 后台运行无法完成验证。请把 1688 浏览器切换为“显示窗口”后采集，并在打开的页面完成验证。`);
  }

  logStep(scope, loginState.reason === "slider_challenge" ? "请在 CloakBrowser 窗口手动拖动滑块；完成后会继续采集。" : "等待手动登录/验证，完成后会继续采集。");

  for (let attempt = 0; attempt < 120; attempt += 1) {
    await sleep(1000);
    const state = await detectLoginPage(page);

    if (!state.isLoginPage) {
      logStep(scope, `${loginState.reason === "slider_challenge" ? "滑块验证" : "登录/验证"}完成，当前URL: ${state.url}`);
      return;
    }

    if (attempt % 10 === 9) {
      logStep(scope, `仍在等待手动验证: ${Math.floor((attempt + 1) / 10) * 10}s`);
    }
  }

  throw new Error(`Still on 1688 login/access challenge page after waiting. Original page: ${originalUrl}`);
}

async function detectLoginPage(page) {
  const snapshot = await page.evaluate(() => {
    const url = location.href;
    const title = document.title || "";
    const text = document.body?.innerText || "";
    const html = document.documentElement?.outerHTML || "";

    return { url, title, text, html };
  });
  const state = detect1688AccessState(snapshot);

  return { isLoginPage: state.blocked, reason: state.reason, url: snapshot.url, title: snapshot.title, message: state.message };
}

async function collectVisibleListLinks(page, productLinks, seenProductIds, maxItems) {
  const values = await page.evaluate(() => [
    ...[...document.querySelectorAll("a[href]")].map((element) => element.href),
    document.documentElement.outerHTML,
  ]);
  const links = extractProductLinks(values.join("\n"), page.url());

  appendProductLinks(productLinks, seenProductIds, links, maxItems);
}

async function collectScrollingOfferListLinks(page, productLinks, seenProductIds, maxItems, label) {
  let staleRounds = 0;
  let lastLoggedCount = productLinks.length;

  for (let round = 1; round <= 40 && productLinks.length < maxItems; round += 1) {
    const beforeCount = productLinks.length;

    await collectVisibleListLinks(page, productLinks, seenProductIds, maxItems);
    await collectReactCardLinks(page, productLinks, seenProductIds, maxItems, `${label} 滚动 ${round}`);

    const added = productLinks.length - beforeCount;
    staleRounds = added > 0 ? 0 : staleRounds + 1;

    if (added > 0 || productLinks.length !== lastLoggedCount || round === 1) {
      logStep("list", `${label} 滚动 ${round}: 新增 ${added}，累计 ${productLinks.length}`);
      lastLoggedCount = productLinks.length;
    }

    if (productLinks.length >= maxItems) break;

    const scrollState = await scrollOfferListDown(page);
    await sleep(900);
    await waitForLoginIfNeeded(page, page.url(), "list");

    if (scrollState.atBottom && staleRounds >= 3) {
      logStep("list", `${label} 已滚动到底部，停止解析`);
      break;
    }

    if (!scrollState.moved && staleRounds >= 3) {
      logStep("list", `${label} 页面不再滚动，停止解析`);
      break;
    }

    if (staleRounds >= 6) {
      logStep("list", `${label} 连续多次无新增商品，停止解析`);
      break;
    }
  }
}

async function collectReactCardLinks(page, productLinks, seenProductIds, maxItems, pageIndex) {
  const links = await page.evaluate(() => {
    const cards = [...document.querySelectorAll('div[style*="cursor: pointer"]')].filter((element) => {
      const style = element.getAttribute("style") || "";
      const text = String(element.textContent || "");
      return /width:\s*230px/.test(style) && element.querySelector("img") && /¥|￥|已售|库存|新人价/.test(text);
    });
    const findOfferId = (root) => {
      const seen = new WeakSet();
      const walk = (value, depth = 0) => {
        if (depth > 8 || value == null) return "";

        if (typeof value === "string" || typeof value === "number") {
          const text = String(value);
          return /^\d{8,}$/.test(text) ? text : "";
        }

        if (typeof value !== "object" || seen.has(value)) return "";

        seen.add(value);

        if (Array.isArray(value)) {
          for (const item of value) {
            const found = walk(item, depth + 1);
            if (found) return found;
          }

          return "";
        }

        if (/^\d{8,}$/.test(String(value.id || ""))) return String(value.id);
        if (/object_type@offer/.test(String(value.expoData || ""))) {
          const match = /object_id@(\d{8,})/.exec(String(value.expoData));
          if (match) return match[1];
        }

        for (const key of Object.keys(value)) {
          if (/^(_owner|_store|ref|stateNode|return|child|sibling|alternate)$/.test(key)) continue;
          const found = walk(value[key], depth + 1);
          if (found) return found;
        }

        return "";
      };

      return walk(root);
    };

    return cards
      .map((card) => {
        const handlerKey = Object.keys(card).find((key) => key.startsWith("__reactEventHandlers"));
        const offerId = handlerKey ? findOfferId(card[handlerKey]) : "";

        return offerId ? `https://detail.1688.com/offer/${offerId}.html` : "";
      })
      .filter(Boolean);
  });
  const beforeCount = productLinks.length;

  appendProductLinks(productLinks, seenProductIds, links, maxItems);
  logStep("list", `${formatListPageLabel(pageIndex)}卡片数据链接: ${productLinks.length - beforeCount}/${links.length}`);
}

function formatListPageLabel(pageIndex) {
  const label = String(pageIndex || "").trim();
  if (!label) return "";
  return label.startsWith("第 ") ? `${label} ` : `第 ${label} 页 `;
}

async function scrollOfferListDown(page) {
  await page.mouse.move(900, 500).catch(() => {});
  await page.mouse.wheel(0, 1200).catch(() => {});

  return page.evaluate(() => {
    const beforeY = window.scrollY;
    const beforeTop = document.scrollingElement?.scrollTop || 0;
    window.scrollBy(0, Math.max(900, Math.floor(window.innerHeight * 0.85)));

    const scrollElement = document.scrollingElement || document.documentElement;
    const afterY = window.scrollY;
    const afterTop = scrollElement.scrollTop || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const scrollHeight = scrollElement.scrollHeight || document.documentElement.scrollHeight || 0;

    return {
      moved: afterY !== beforeY || afterTop !== beforeTop,
      atBottom: afterTop + viewportHeight >= scrollHeight - 80,
      scrollTop: afterTop,
      scrollHeight,
    };
  });
}

async function collectCardPopupLinks(page, productLinks, seenProductIds, maxItems, pageIndex) {
  const cardCount = await page.evaluate(() => {
    const findCards = () =>
      [...document.querySelectorAll('div[style*="cursor: pointer"]')].filter((element) => {
        const style = element.getAttribute("style") || "";
        const text = String(element.textContent || "");
        return /width:\s*230px/.test(style) && element.querySelector("img") && /¥|￥|已售|库存|新人价/.test(text);
      });

    return findCards().length;
  });

  logStep("list", `第 ${pageIndex} 页可点击商品卡片: ${cardCount}`);

  for (let cardIndex = 0; cardIndex < cardCount && productLinks.length < maxItems; cardIndex += 1) {
    const beforeUrl = page.url();
    const popupPromise = page.waitForEvent("popup", { timeout: 6000 }).catch(() => null);
    const clicked = await page.evaluate((index) => {
      const cards = [...document.querySelectorAll('div[style*="cursor: pointer"]')].filter((element) => {
        const style = element.getAttribute("style") || "";
        const text = String(element.textContent || "");
        return /width:\s*230px/.test(style) && element.querySelector("img") && /¥|￥|已售|库存|新人价/.test(text);
      });
      const card = cards[index];
      if (!card) return { ok: false, text: "" };

      card.scrollIntoView({ block: "center" });
      card.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

      return { ok: true, text: String(card.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80) };
    }, cardIndex);

    if (!clicked.ok) continue;

    const popup = await popupPromise;
    let detailUrl = "";

    if (popup) {
      await popup.waitForLoadState("domcontentloaded", { timeout: 10000 }).catch(() => {});
      detailUrl = normalizeProductDetailUrl(popup.url(), beforeUrl);
      await popup.close().catch(() => {});
    } else {
      await sleep(800);
      if (isProductDetailUrl(page.url())) {
        detailUrl = normalizeProductDetailUrl(page.url(), beforeUrl);
        await page.goBack({ waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
        await sleep(1200);
      }
    }

    const added = appendProductLinks(productLinks, seenProductIds, [detailUrl], maxItems);
    logStep(
      "list",
      `第 ${pageIndex} 页卡片 ${cardIndex + 1}/${cardCount}: ${added ? detailUrl : detailUrl ? "重复链接" : "未打开详情页"} ${clicked.text}`,
    );
  }
}

async function readOfferListPagination(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText || "";
    const matches = [...text.matchAll(/(\d{1,4})\s*\/\s*(\d{1,4})/g)]
      .map((match) => ({ current: Number(match[1]), total: Number(match[2]) }))
      .filter((item) => item.current > 0 && item.total > 0 && item.current <= item.total);
    const pagination = matches.sort((left, right) => right.total - left.total)[0];

    return pagination || { current: 0, total: 0 };
  });
}

async function scrollOfferListPaginationIntoView(page) {
  await page.mouse.move(900, 500).catch(() => {});

  for (let attempt = 0; attempt < 8; attempt += 1) {
    const hasPagination = await page.evaluate(() => /\d{1,4}\s*\/\s*\d{1,4}/.test(document.body?.innerText || ""));

    if (hasPagination) return true;

    await page.mouse.wheel(0, 900).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 900)).catch(() => {});
    await sleep(500);
  }

  return false;
}

async function clickNextOfferListPage(page, previousPage) {
  await scrollOfferListPaginationIntoView(page);
  const before = await readOfferListPagination(page);
  const clicked = await page.evaluate(() => {
    const controls = [...document.querySelectorAll("button,a,div,span")];
    const next = controls.find((element) => {
      const text = String(element.textContent || "").replace(/\s+/g, " ").trim();
      return text === "下一页" || text === "下一页 >" || text === "下一页>";
    });

    if (!next) return false;

    const style = getComputedStyle(next);
    const disabled =
      next.disabled ||
      next.getAttribute("aria-disabled") === "true" ||
      /disabled/.test(next.className || "") ||
      style.cursor === "not-allowed" ||
      style.pointerEvents === "none";

    if (disabled) return false;

    next.scrollIntoView({ block: "center" });
    next.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, view: window }));

    return true;
  });

  if (!clicked) return null;

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(500);
    const after = await readOfferListPagination(page);

    if (after.current && after.current !== (before.current || previousPage)) return after;
  }

  return null;
}

function appendProductLinks(productLinks, seenProductIds, links, maxItems) {
  let added = false;

  for (const link of links) {
    const normalized = normalizeProductDetailUrl(link || "", "");
    const productId = extractProductId(normalized);

    if (!productId || seenProductIds.has(productId)) continue;

    productLinks.push(normalized);
    seenProductIds.add(productId);
    added = true;

    if (productLinks.length >= maxItems) break;
  }

  return added;
}

async function openProductDetailSection(page) {
  const result = await page.evaluate(() => {
    const detailTab = [...document.querySelectorAll("a,button,div,span")]
      .find((element) => element.textContent?.trim() === "商品详情");

    detailTab?.click?.();

    const description = document.querySelector("#description");
    description?.scrollIntoView({ block: "start" });

    return {
      clickedDetailTab: Boolean(detailTab),
      hasDescription: Boolean(description),
    };
  });
  logStep("detail", `点击商品详情Tab: ${result.clickedDetailTab ? "是" : "否"}`);
  logStep("detail", `滚动到#description: ${result.hasDescription ? "是" : "否"}`);
  await sleep(1000);
}

async function waitForDetailData(page) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const detailData = await page.evaluate((allowedKeys) => {
      const sourceTitle =
        document.title ||
        document.querySelector("#productTitle, .title-text, .product-title")?.textContent?.trim() ||
        "";
      const hosts = [
        ...document.querySelectorAll("#description > div > div.od-collapse-module > div.collapse-body *"),
      ].filter((element) => element.tagName.toLowerCase().startsWith("v-detail-"));
      const host = hosts.find((element) => element.shadowRoot?.querySelector("#detail"));
      const container = host?.shadowRoot?.querySelector("#detail");
      const containerSource = host ? `${host.tagName.toLowerCase()}.shadowRoot #detail img` : "none";

      if (!container) {
        return {
          imageUrls: [],
          attributes: [],
          packageInfo: { weightG: "" },
          sourceTitle,
          debug: {
            containerSource,
            hostFound: Boolean(host),
            shadowRootFound: Boolean(host?.shadowRoot),
            imageElementCount: 0,
            htmlImageMatches: 0,
            textPreview: "",
          },
        };
      }

      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
      const readPackageInfo = (doc) => {
        const packageRoot =
          doc.querySelector("#productPackInfo") ??
          doc.querySelector("#productPackInfoModule") ??
          doc.querySelector(".module-od-product-pack-info") ??
          doc.body;
        const packageInfo = { weightG: "", dimensionsText: "" };
        const packageText = clean(packageRoot.innerText);
        const dimensionTexts = [];

        for (const table of packageRoot.querySelectorAll("table")) {
          const tableText = clean(table.innerText);
          if (/尺寸|长\s*(?:\(cm\)|（cm）)?|宽\s*(?:\(cm\)|（cm）)?|高\s*(?:\(cm\)|（cm）)?|\d+(?:\.\d+)?\s*(?:x|\*|×)\s*\d+/i.test(tableText)) {
            dimensionTexts.push(tableText);
          }

          const rows = [...table.querySelectorAll("tr")].map((row) =>
            [...row.querySelectorAll("th,td")].map((cell) => clean(cell.textContent)),
          );

          for (let rowIndex = 0; rowIndex < rows.length; rowIndex += 1) {
            const weightIndex = rows[rowIndex].findIndex((cell) => /^重量(?:\(g\)|（g）)?$/.test(cell));
            if (weightIndex === -1) continue;

            const sameRowValue = rows[rowIndex][weightIndex + 1];
            const nextRowValue = rows[rowIndex + 1]?.[weightIndex] ?? rows[rowIndex + 1]?.[0];
            packageInfo.weightG = clean(sameRowValue || nextRowValue).replace(/[^0-9.]/g, "");
          }
        }

        packageInfo.dimensionsText = dimensionTexts[0] || packageText;

        if (!packageInfo.weightG) {
          const match =
            /重量\s*(?:\(g\)|（g）)?\s*([0-9]+(?:\.[0-9]+)?)/.exec(packageText) ??
            /重量\s*(?:\(g\)|（g）)?\s+([0-9]+(?:\.[0-9]+)?)/.exec(packageText) ??
            /商品件重尺[\s\S]{0,80}?重量\s*(?:\(g\)|（g）)?[\s\S]{0,40}?([0-9]+(?:\.[0-9]+)?)/.exec(packageText);
          packageInfo.weightG = match?.[1] ?? "";
        }

        return packageInfo;
      };
      const allowed = new Set(allowedKeys);
      const attributes = new Map();
      const packageInfo = readPackageInfo(document);

      container.scrollIntoView({ block: "start" });

      for (const row of container.querySelectorAll("tr")) {
        const cells = [...row.querySelectorAll("th,td")].map((cell) => clean(cell.textContent)).filter(Boolean);

        for (let index = 0; index < cells.length - 1; index += 2) {
          if (allowed.has(cells[index]) && !attributes.has(cells[index])) {
            attributes.set(cells[index], cells[index + 1]);
          }
        }
      }

      if (!packageInfo.weightG) {
        const text = clean(container.innerText);
        const match =
          /重量\s*(?:\(g\)|（g）)?\s*([0-9]+(?:\.[0-9]+)?)/.exec(text) ??
          /商品件重尺[\s\S]{0,80}?重量\s*(?:\(g\)|（g）)?[\s\S]{0,40}?([0-9]+(?:\.[0-9]+)?)/.exec(text);
        packageInfo.weightG = match?.[1] ?? "";
      }

      const imageUrls = [...container.querySelectorAll("img")]
        .map((image) => {
          const src =
            image.currentSrc ||
            image.getAttribute("src") ||
            image.getAttribute("data-src") ||
            image.getAttribute("data-lazy-src") ||
            image.getAttribute("data-lazyload-src") ||
            image.getAttribute("data-ks-lazyload") ||
            image.getAttribute("data-img") ||
            image.getAttribute("data-url") ||
            image.getAttribute("data-original") ||
            image.getAttribute("srcset")?.split(",")[0]?.trim().split(/\s+/)[0] ||
            "";

          try {
            return src ? new URL(src, location.href).toString() : "";
          } catch {
            return "";
          }
        })
        .filter(Boolean);

      for (const match of container.innerHTML.matchAll(/(?:https?:)?\/\/[^"'()<>\s]+alicdn\.com\/[^"'()<>\s]+\.(?:jpg|jpeg|png|webp|gif)(?:_[^"'()<>\s]*)?/gi)) {
        try {
          imageUrls.push(new URL(match[0], location.href).toString());
        } catch {}
      }

      return {
        imageUrls,
        attributes: [...attributes].map(([name, value]) => ({ name, value })),
        packageInfo,
        sourceTitle,
        debug: {
          containerSource,
          hostFound: Boolean(host),
          shadowRootFound: Boolean(host?.shadowRoot),
          imageElementCount: container.querySelectorAll("img").length,
          htmlImageMatches: [...container.innerHTML.matchAll(/(?:https?:)?\/\/[^"'()<>\s]+alicdn\.com\/[^"'()<>\s]+\.(?:jpg|jpeg|png|webp|gif)/gi)].length,
          textPreview: clean(container.innerText).slice(0, 120),
        },
      };
    }, productAttributeKeys);

    logStep(
      "detail",
      `尝试 ${attempt + 1}: 容器=${detailData.debug?.containerSource ?? "unknown"}, host=${detailData.debug?.hostFound ? "是" : "否"}, shadow=${detailData.debug?.shadowRootFound ? "是" : "否"}, img元素=${detailData.debug?.imageElementCount ?? 0}, html图片=${detailData.debug?.htmlImageMatches ?? 0}, 原始URL=${detailData.imageUrls.length}, 属性=${detailData.attributes.length}, 重量=${detailData.packageInfo.weightG || "(空)"}`,
    );
    if (attempt === 0 && detailData.debug?.textPreview) {
      logStep("detail", `容器文本预览: ${detailData.debug.textPreview}`);
    }

    if (detailData.imageUrls.length > 0 && attempt >= 3) {
      const filtered = filterProductImageUrls(detailData.imageUrls);
      logStep("images", `详情URL过滤: ${detailData.imageUrls.length} -> ${filtered.length}`);
      logSample("images-raw", detailData.imageUrls);
      logSample("images-filtered", filtered);
      return {
        imageUrls: filtered,
        attributes: detailData.attributes,
        packageInfo: detailData.packageInfo,
        sourceTitle: detailData.sourceTitle,
      };
    }

    if (attempt === 39 && (detailData.imageUrls.length > 0 || detailData.attributes.length > 0)) {
      const filtered = filterProductImageUrls(detailData.imageUrls);
      logStep("images", `最终尝试URL过滤: ${detailData.imageUrls.length} -> ${filtered.length}`);
      logSample("images-raw", detailData.imageUrls);
      logSample("images-filtered", filtered);
      return {
        imageUrls: filtered,
        attributes: detailData.attributes,
        packageInfo: detailData.packageInfo,
        sourceTitle: detailData.sourceTitle,
      };
    }

    await page.mouse.wheel(0, 1400).catch(() => {});
    await sleep(500);
  }

  return {
    imageUrls: [],
    attributes: [],
    packageInfo: { weightG: "", dimensionsText: "" },
    sourceTitle: "",
  };
}

function extractProductLinks(html, baseUrl) {
  const urlsByProductId = new Map();
  const normalizedHtml = String(html || "")
    .replace(/\\u002F/gi, "/")
    .replace(/\\\//g, "/")
    .replace(/&amp;/g, "&");
  const patterns = [
    /https?:\/\/detail\.1688\.com\/offer\/\d+\.html[^"'<>\s)]*/gi,
    /\/\/detail\.1688\.com\/offer\/\d+\.html[^"'<>\s)]*/gi,
    /(?:href|url)=["']([^"']*\/offer\/\d+\.html[^"']*)["']/gi,
    /\/offer\/\d+\.html[^"'<>\s)]*/gi,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(normalizedHtml))) {
      const url = normalizeProductDetailUrl(match[1] ?? match[0], baseUrl);
      const productId = extractProductId(url);

      if (productId && !urlsByProductId.has(productId)) urlsByProductId.set(productId, url);
    }
  }

  return [...urlsByProductId.values()];
}

function extractImageUrls(html) {
  const urls = new Set();
  const pattern = /(?:https?:)?\\?\/\\?\/[^"'\\<>\s]+alicdn\.com[^"'\\<>\s]+\.(?:jpg|jpeg|png|webp)(?:_[^"'\\<>\s]*)?/gi;
  let match;

  while ((match = pattern.exec(html))) {
    urls.add(normalizeUrl(match[0]).replace(/\\u002F/g, "/"));
  }

  return [...urls].filter((url) => !url.includes("TB1") || url.includes("alicdn.com"));
}

function extractFullPathImageUrls(html) {
  const urls = [];
  const pattern = /"(?:fullPathImageURI|imageUrl)"\s*:\s*"([^"]+)"/g;
  let match;

  while ((match = pattern.exec(html))) {
    urls.push(match[1]);
  }

  return urls;
}

function filterProductImageUrls(urls) {
  return unique(urls)
    .map(normalizeProductImageUrl)
    .filter(Boolean)
    .filter((url) => /^https:\/\/(?:cbu01|img|gw)\.alicdn\.com\//i.test(url))
    .filter((url) => /\/(?:img\/ibank|imgextra)\//i.test(url))
    .filter((url) => !/-\d+-tps-\d+-\d+/i.test(url))
    .filter((url) => !/-\d+-overseas_pic\./i.test(url))
    .filter((url) => /\.(?:jpg|jpeg|png|webp|gif)(?:$|[_.?])/i.test(url));
}

function normalizeProductImageUrl(url) {
  const normalized = normalizeUrl(url)
    .replace(/\.jpg_(?:\d+x\d+|sum|b)\.jpg$/i, ".jpg")
    .replace(/\.jpg_\.webp$/i, ".jpg")
    .replace(/\.png_\.webp$/i, ".png")
    .replace(/\.gif_\.webp$/i, ".gif");

  return normalized;
}

function extractAttributes(html) {
  const attributes = [];
  const seen = new Set();
  const patterns = [
    /["'](?:name|attrName|attributeName)["']\s*:\s*["']([^"']{1,40})["'][\s\S]{0,120}?["'](?:value|attrValue|valueName)["']\s*:\s*["']([^"']{1,120})["']/g,
    /<[^>]*(?:class|data-spm)[^>]*>[\s\S]{0,80}?([\u4e00-\u9fa5A-Za-z ]{2,30})[\s:：]+([\u4e00-\u9fa5A-Za-z0-9 .,%/-]{1,100})[\s\S]{0,80}?<\/[^>]+>/g,
  ];

  for (const pattern of patterns) {
    let match;
    while ((match = pattern.exec(html))) {
      const name = cleanText(match[1]);
      const value = cleanText(match[2]);
      const key = `${name}:${value}`;

      if (!name || !value || seen.has(key)) continue;
      seen.add(key);
      attributes.push({ name, value });
    }
  }

  return filterProductAttributes(attributes);
}

function filterProductAttributes(attributes) {
  const allowed = new Set(productAttributeKeys);
  const seen = new Set();
  const filtered = [];

  for (const attribute of attributes) {
    const name = cleanText(attribute.name);
    const value = cleanText(attribute.value);

    if (!allowed.has(name) || !value || seen.has(name)) continue;
    seen.add(name);
    filtered.push({ name, value });
  }

  return filtered;
}

function buildListingTitle(sourceTitle, attributes) {
  const cleaned = cleanProductTitle(sourceTitle, attributes);
  if (cleaned.title) return cleaned;

  const attributeMap = Object.fromEntries(attributes.map((item) => [item.name, item.value]));
  const fallback = inferProductClass(sourceTitle, attributeMap);

  return {
    title: fallback,
    titleParts: cleaned.titleParts || [],
    productTypeText: cleaned.productTypeText || "",
  };
}

function inferProductClass(sourceTitle, attributeMap) {
  const values = [sourceTitle, attributeMap["箱包潮流款式"], attributeMap["风格"]].filter(Boolean).join(" ");
  const classes = [
    "晚宴包",
    "手拿包",
    "礼服包",
    "派对包",
    "宝石包",
    "半圆包",
    "立体袋",
    "单肩包",
    "斜挎包",
    "手提包",
    "女包",
  ];

  return classes.find((item) => values.includes(item)) ?? firstValue(attributeMap["箱包潮流款式"]) ?? "包";
}

function extractCoreProductTitle(sourceTitle) {
  const title = cleanTitle(sourceTitle)
    .replace(/^[A-Za-z0-9\s-]+(?=[\u4e00-\u9fa5])/g, "")
    .replace(/^(?:跨境|外贸|欧美|日韩|202\d|20\d{2}|新款|爆款|厂家|批发|现货|向日葵)+/g, "")
    .replace(/(?:适合|用于).+$/g, "");
  const productClasses = ["晚宴包", "礼服包", "派对包", "手拿包", "手提包", "单肩包", "斜挎包", "宝石包", "半圆包", "女包"];
  const candidates = [];

  for (const productClass of productClasses) {
    let startIndex = 0;

    while (true) {
      const classIndex = title.indexOf(productClass, startIndex);
      if (classIndex === -1) break;

      const end = classIndex + productClass.length;
      const beforeTarget = title.slice(0, end);
      const previousClassEnd =
        productClasses
          .filter((item) => item !== productClass)
          .map((item) => beforeTarget.lastIndexOf(item))
          .filter((index) => index >= 0)
          .map((index) => index + productClasses.find((item) => beforeTarget.slice(index).startsWith(item)).length)
          .sort((left, right) => right - left)[0] ?? 0;
      const candidate = cleanCoreTitleCandidate(beforeTarget.slice(previousClassEnd));

      if (candidate) {
        candidates.push({
          value: candidate,
          score: scoreTitleCandidate(candidate),
        });
      }

      startIndex = end;
    }
  }

  return candidates.sort((left, right) => right.score - left.score)[0]?.value ?? "";
}

function cleanCoreTitleCandidate(value) {
  return cleanText(value)
    .replace(/^(?:时尚|宴会|外贸|欧美|跨境|新款|名媛|礼服|宴会|女|包|生日|婚礼)+/g, "")
    .replace(/(?:欧美|复古风|名媛|礼服|宴会|生日|婚礼|女).*$/g, "")
    .trim();
}

function scoreTitleCandidate(value) {
  let score = value.length;

  if (/(镶钻|花钻|水钻|钻石|孔雀|叶子花|合金|珍珠|亮片|金属)/.test(value)) score += 30;
  if (/(生日|婚礼|宴会|名媛|礼服|单肩|斜挎)/.test(value)) score -= 20;
  if (value.length > 16) score -= value.length - 16;
  if (value.length < 4) score -= 20;

  return score;
}

function splitValues(value) {
  return cleanText(value).split(/[,，/、]/).map((item) => item.trim()).filter(Boolean);
}

function firstValue(value) {
  return splitValues(value)[0] ?? "";
}

function buildEnglishDraftTitle(title) {
  const translated = translateChinesePhrase(title);

  return containsChinese(translated) ? "" : translated;
}

function buildEnglishFeatureBullets(attributeMap, groupName) {
  const material = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["材质"])), "");
  const shape = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["箱包形状"])), "");
  const closure = translateClosure(firstValue(attributeMap["开盖方式"]));
  const lining = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["里料质地"])), "");
  const occasion = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["适用场景"])), "");
  const elements = splitValues(attributeMap["流行元素"]).map(translateChinesePhrase).filter((item) => item && !containsChinese(item));
  const hardness = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["硬度"])), "");
  const closureLabel = closure && /closure|clasp|lock/i.test(closure) ? closure : `${closure} closure`;
  const bullets = [
    `${groupName} designed as a statement accessory for evening styling.`,
    [shape, material?.toLowerCase(), "hard-case structure"].filter(Boolean).join(" ") + ".",
    elements.length > 0 ? `Decorative ${elements.join(" and ").toLowerCase()} details for a polished occasion look.` : "",
    closure ? `${closureLabel} keeps small essentials secured during parties and dinners.` : "",
    lining ? `${lining} lining with compact space for cards, lipstick, keys, and small accessories.` : "",
    occasion ? `Suitable for ${occasion.toLowerCase()}, weddings, parties, dinners, and formal occasions.` : "",
    hardness ? `${hardness} body helps maintain the structured clutch shape.` : "",
  ];

  return bullets.map(cleanSentence).filter(Boolean).slice(0, 5);
}

function translateColourList(value) {
  return splitValues(value)
    .map((item) => translateChinesePhrase(item))
    .filter((item) => item && !containsChinese(item))
    .join(" / ");
}

function buildEnglishDescription({ safeDescription, groupName, attributeMap, material, closure }) {
  if (safeDescription) return safeDescription;

  const shape = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["箱包形状"])), "");
  const lining = safeEnglishValue(translateChinesePhrase(firstValue(attributeMap["里料质地"])), "");
  const elements = splitValues(attributeMap["流行元素"]).map(translateChinesePhrase).filter((item) => item && !containsChinese(item));
  const article = /^[aeiou]/i.test(groupName) ? "An" : "A";
  const parts = [
    `${article} ${groupName.toLowerCase()} designed for evening events, parties, dinners, weddings, and formal occasions.`,
    [shape, material?.toLowerCase(), "structured body"].filter(Boolean).join(" ") + " gives the bag a polished occasion-ready look.",
    elements.length > 0 ? `Decorative ${elements.join(" and ").toLowerCase()} details add sparkle and visual interest.` : "",
    closure ? `The ${closure.toLowerCase()} closure helps keep small essentials secure.` : "",
    lining ? `The ${lining.toLowerCase()} lining and compact interior are suitable for cards, lipstick, keys, and small accessories.` : "",
    "A statement accessory for dresses, abayas, and elegant evening outfits.",
  ];

  return parts.map(cleanSentence).filter(Boolean).join(" ");
}

function buildArabicProductName(englishName) {
  if (!englishName) return "";
  const lower = englishName.toLowerCase();
  const descriptors = [];

  if (lower.includes("leaf floral")) descriptors.push("بتصميم أوراق وزهور");
  if (lower.includes("peacock")) descriptors.push("بتصميم طاووس");
  if (lower.includes("butterfly")) descriptors.push("على شكل فراشة");
  if (lower.includes("rhinestone")) descriptors.push("مرصعة بالكريستال");
  if (lower.includes("metal") || lower.includes("alloy")) descriptors.push("معدنية");
  if (lower.includes("clutch") || lower.includes("evening")) {
    return ["حقيبة سهرة يد", ...descriptors].join(" ");
  }

  return ["حقيبة نسائية", ...descriptors].join(" ");
}

function buildArabicFeatureBullets(englishBullets) {
  return englishBullets.map(translateEnglishSentenceToArabic).filter(Boolean).slice(0, 5);
}

function buildArabicDescription({ groupNameAr, featureBulletsAr }) {
  const details = featureBulletsAr.filter(Boolean).join(" ");

  return cleanText(`${groupNameAr} مصممة لإطلالة أنيقة في السهرات والحفلات والمناسبات الرسمية. ${details}`);
}

function translateEnglishSentenceToArabic(value) {
  const text = cleanText(value).toLowerCase();

  if (!text) return "";
  if (text.includes("statement accessory")) return "إكسسوار لافت يمنح إطلالة أنيقة للمناسبات والسهرات.";
  if (text.includes("hard-case") || text.includes("structured")) return "هيكل صلب ومنظم يساعد في الحفاظ على شكل الحقيبة.";
  if (text.includes("decorative") || text.includes("rhinestone")) return "تفاصيل زخرفية لامعة تضيف مظهرا أنيقا وجذابا.";
  if (text.includes("keeps small essentials secured")) return "إغلاق عملي يساعد على حفظ الأغراض الصغيرة بأمان.";
  if (text.includes("lining") || text.includes("compact space")) return "مساحة داخلية مدمجة مناسبة للبطاقات وأحمر الشفاه والمفاتيح والإكسسوارات الصغيرة.";
  if (text.includes("suitable")) return "مناسبة للأعراس والحفلات والعشاء والمناسبات الرسمية.";
  if (text.includes("body helps maintain")) return "جسم صلب يساعد على الحفاظ على شكل الكلاتش المنظم.";

  return "";
}

function translateEnglishToArabic(value) {
  let translated = cleanText(value);
  const phrases = [
    ["Gold White Rhinestone", "ذهبي مع كريستال أبيض"],
    ["Gold Rhinestone", "ذهبي مرصع بالكريستال"],
    ["Rose Red", "وردي داكن"],
    ["Orange Red", "برتقالي محمر"],
    ["Purple", "بنفسجي"],
    ["Orange", "برتقالي"],
    ["Gold", "ذهبي"],
    ["Silver", "فضي"],
    ["Champagne", "شمبانيا"],
    ["White", "أبيض"],
    ["Red", "أحمر"],
    ["Custom", "مخصص"],
    ["Pink", "وردي"],
    ["Black", "أسود"],
    ["Green", "أخضر"],
    ["Blue", "أزرق"],
    ["Leaf Floral Rhinestone Evening Bag", "حقيبة سهرة بتصميم أوراق وزهور مرصعة بالكريستال"],
    ["Peacock Rhinestone Clutch Bag", "حقيبة يد بتصميم طاووس مرصعة بالكريستال"],
    ["Rhinestone Evening Bag", "حقيبة سهرة مرصعة بالكريستال"],
    ["Evening Bag", "حقيبة سهرة"],
    ["Clutch Bag", "حقيبة يد"],
  ];

  for (const [source, target] of phrases) {
    translated = translated.replaceAll(source, target);
  }

  return /[A-Za-z]/.test(translated) ? "" : translated;
}

function cleanSentence(value) {
  const cleaned = cleanText(value).replace(/\s+\./g, ".").replace(/\.\.+/g, ".");

  return cleaned === "." ? "" : cleaned;
}

function buildVariantPolicy(sourceColours) {
  return {
    groupingMode: sourceColours.length > 1 ? "split_by_colour_then_group" : "single_colour_sku",
    rule: "One colour = one SKU, one Barcode, independent stock, independent price. Same style colours are merged in noon backend Groups into one frontend product link.",
    sourceColours,
    requiresSkuSplit: sourceColours.length > 1,
    groupKey: "",
  };
}

function defaultUploadConfig() {
  return {
    country_code: "sa",
    id_partner: "517205",
    legal_entity: "LE4PFJU3HCN",
    contract_order_number: "MPC4NRVOLTSA",
    origin: "noon SA (Origin CN)",
    warehouse_code: "W00183886CN",
    warehouse_name: "China NGS Test Warehouse",
    global_product_update_required: true,
    global_price_update_required: true,
    stock_import_required: true,
    group_after_live: true,
  };
}

function translateClosure(value) {
  const translated = translateChinesePhrase(value);

  if (/magnetic/i.test(translated)) return "Magnetic";
  if (/zipper/i.test(translated)) return "Zipper";
  if (/kiss lock/i.test(translated)) return "Kiss Lock";
  if (/open top/i.test(translated)) return "Open Top";
  if (/lock|clasp/i.test(translated)) return "Clasp";
  return safeEnglishValue(translated, "Clasp");
}

function hasRhinestone(meta) {
  return /镶钻|钻|Rhinestone/i.test([meta.title, meta.sourceTitle, ...meta.attributes.map((item) => item.value)].join(" "));
}

function suggestedNoonWeightKg(weightG) {
  const grams = Number.parseFloat(weightG);

  if (!Number.isFinite(grams) || grams <= 0) return 1;
  return Math.max(1, Math.ceil(grams / 1000));
}

function suggestedNoonPrice(price) {
  const multiplier = 1.0;
  const value = Number.parseFloat(price?.value);

  if (!Number.isFinite(value) || value <= 0) return null;
  return Number((value * multiplier).toFixed(2));
}

function buildModelName(groupName, meta) {
  if (hasRhinestone(meta)) return "Rhinestone Evening Clutch";
  return `${groupName} Clutch`.replace(/\bClutch Clutch\b/i, "Clutch");
}

function buildDetailedFeatures(meta) {
  const attributeMap = Object.fromEntries((meta.attributes || []).map((item) => [item.name, item.value]));
  const text = normalizeFeatureText([
    meta.title,
    meta.sourceTitle,
    Object.values(attributeMap).join(" "),
    meta.description,
  ].join(" "));
  const features = [];

  addDetailedFeature(features, "Lightweight", /轻便|小巧|小众|晚宴|手拿|手抓|clutch|evening|compact|lightweight/.test(text));
  addDetailedFeature(features, "Wristlet", /手拿|手抓|腕带|wristlet|clutch/.test(text));
  addDetailedFeature(features, "Detachable Straps", /链条|肩带|单肩|斜挎|strap|chain|shoulder|crossbody/.test(text));
  addDetailedFeature(features, "Multi Compartment", /夹层|隔层|内袋|口袋|手机袋|证件袋|卡位|compartment|pocket|card/.test(text));
  addDetailedFeature(features, "Waterproof", /防水|waterproof/.test(text));
  addDetailedFeature(features, "Foldable", /折叠|可折叠|foldable/.test(text));
  addDetailedFeature(features, "Expandable", /扩容|可扩展|expandable/.test(text));
  addDetailedFeature(features, "Hidden Pockets", /暗袋|隐藏口袋|hidden pocket/.test(text));
  addDetailedFeature(features, "Adjustable Straps", /可调节|调节肩带|adjustable strap/.test(text));

  return features.length > 0 ? features.slice(0, 5) : ["Lightweight"];
}

function addDetailedFeature(features, feature, condition) {
  if (condition && !features.includes(feature)) features.push(feature);
}

function normalizeFeatureText(value) {
  return cleanText(value).toLowerCase();
}

function extractProductYear(sourceTitle, season) {
  const fromTitle = /20\d{2}/.exec(sourceTitle)?.[0];
  const fromSeason = /20\d{2}/.exec(season)?.[0];
  const year = Number.parseInt(fromTitle ?? fromSeason ?? "2026", 10);

  return Number.isFinite(year) ? year : 2026;
}

function sanitizeNoonDescription(description) {
  const text = cleanText(description);

  if (
    !text ||
    containsChinese(text) ||
    /1688|Alibaba|阿里巴巴|起批|发货|运费|退款|退货|包邮|采购|供应商|工厂|库存|跨境供货|批发|上门取件|服务|货源/i.test(text)
  ) {
    return "";
  }

  return text;
}

function buildSubmissionGate({ englishTitle, featureBullets, longDescription, meta, offerPrice, sourceColours }) {
  const blockingIssues = [];
  const warnings = [];

  if (!englishTitle) blockingIssues.push("English title is missing or still contains Chinese.");
  if (meta.price?.currency === "CNY" && offerPrice === null) {
    blockingIssues.push("Source price is CNY; noon offer price must be reviewed and converted to AED/SAR/EGP.");
  }
  if (meta.images.length === 0) blockingIssues.push("No product images were downloaded.");
  if (featureBullets.length === 0) warnings.push("Feature bullets need English review.");
  if (!longDescription) warnings.push("Long description is blank because 1688 service/supplier text was removed or no safe product description was found.");
  for (const warning of meta.dimensions?.warnings || []) warnings.push(warning);
  for (const warning of meta.imageAssignmentWarnings || []) warnings.push(warning);

  return {
    status: blockingIssues.length > 0 ? "blocked" : "ready_for_manual_review",
    successDefinition: [
      "Step 1 Product Identity is saved as a local draft only.",
      "Step 2 Product Content is saved as a local draft only.",
      "Step 3 Offer Details must be manually reviewed; do not submit to noon review automatically.",
    ],
    blockingIssues,
    warnings,
    sourcePrice: meta.price
      ? {
          value: meta.price.value,
          currency: meta.price.currency,
        }
      : null,
  };
}

function translateAttributeName(name) {
  const map = {
    材质: "Material",
    箱包形状: "Shape",
    开盖方式: "Closure",
    货号: "Model Number",
    包内部结构: "Interior",
    风格: "Style",
    外袋种类: "Outer Pocket Type",
    有可授权的自有品牌: "Authorized Brand",
    有无夹层: "Compartment",
    箱包潮流款式: "Bag Style",
    里料质地: "Lining Material",
    硬度: "Hardness",
    适用场景: "Occasion",
    流行元素: "Design Element",
    品牌: "Brand",
    颜色: "Colour",
    上市年份季节: "Season",
  };

  return map[name] ?? "";
}

function translateChinesePhrase(value) {
  let translated = cleanText(value);
  const phrases = [
    ["合金花钻镶钻晚宴包", "Alloy Floral Rhinestone Evening Bag"],
    ["叶子花镶钻晚宴包", "Leaf Floral Rhinestone Evening Bag"],
    ["孔雀镶钻手拿包", "Peacock Rhinestone Clutch Bag"],
    ["镶钻晚宴包", "Rhinestone Evening Bag"],
    ["晚宴包", "Evening Bag"],
    ["手拿包", "Clutch Bag"],
    ["单肩包", "Shoulder Bag"],
    ["斜挎包", "Crossbody Bag"],
    ["手提包", "Top Handle Bag"],
    ["女包", "Women's Bag"],
    ["礼服包", "Evening Clutch"],
    ["派对包", "Party Bag"],
    ["小方包", "Small Square Bag"],
    ["宝石包", "Jewel Bag"],
    ["半圆包", "Half Moon Bag"],
    ["半圆形", "Half Moon"],
    ["横款方型", "Horizontal Square"],
    ["横款方形", "Horizontal Square"],
    ["枕头型", "Pillow Shape"],
    ["水桶型", "Bucket Shape"],
    ["钱袋型", "Pouch Shape"],
    ["软袋形", "Soft Pouch"],
    ["鹦鹉型", "Parrot Shape"],
    ["心形", "Heart Shape"],
    ["椭圆形", "Oval"],
    ["椭圆", "Oval"],
    ["其它", ""],
    ["其他", ""],
    ["金属", "Metal"],
    ["合金", "Alloy"],
    ["镶钻", "Rhinestone"],
    ["花钻", "Floral Rhinestone"],
    ["孔雀", "Peacock"],
    ["金底白钻", "Gold White Rhinestone"],
    ["金底金钻", "Gold Rhinestone"],
    ["香槟色", "Champagne"],
    ["香槟", "Champagne"],
    ["粉彩", "Pastel"],
    ["彩色", "Multicolour"],
    ["蓝彩", "Blue Multicolour"],
    ["黑灰", "Black Grey"],
    ["黑白渐变", "Black White Gradient"],
    ["浅金", "Light Gold"],
    ["浅紫", "Light Purple"],
    ["深红", "Dark Red"],
    ["酒红色", "Wine Red"],
    ["花色", "Floral"],
    ["ab彩", "AB Colour"],
    ["AB彩", "AB Colour"],
    ["银色", "Silver"],
    ["金色", "Gold"],
    ["黑色", "Black"],
    ["紫色", "Purple"],
    ["玫红色", "Rose Red"],
    ["粉色", "Pink"],
    ["橘红色", "Orange Red"],
    ["红色", "Red"],
    ["白色", "White"],
    ["米色", "Beige"],
    ["橘色", "Orange"],
    ["个性定制", "Custom"],
    ["绿色", "Green"],
    ["蓝色", "Blue"],
    ["银", "Silver"],
    ["红", "Red"],
    ["粉", "Pink"],
    ["米", "Ivory"],
    ["磁扣", "Magnetic Closure"],
    ["锁扣", "Lock Closure"],
    ["拉链", "Zipper Closure"],
    ["夹口", "Kiss Lock Closure"],
    ["敞口", "Open Top"],
    ["硬", "Hard"],
    ["PU", "PU"],
    ["涤纶", "Polyester"],
    ["合成革", "Synthetic Leather"],
    ["格利特", "Glitter"],
    ["棉", "Cotton"],
    ["跨境风潮", "Cross-Border Fashion"],
    ["日常搭配", "Daily Wear"],
    ["证件袋", "ID Pocket"],
    ["手机袋", "Phone Pocket"],
    ["镂空", "Hollow Out"],
    ["珍珠", "Pearl"],
    ["亮片", "Sequins"],
    ["几何图案", "Geometric Pattern"],
    ["钻款", "Rhinestone Style"],
    ["款", ""],
  ];

  for (const [source, target] of phrases) {
    translated = translated.replaceAll(source, target);
  }

  return translated
    .replace(/[（）]/g, " ")
    .replace(/\+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\s+/g, " ")
    .trim();
}

function stableNoonColour(sourceColour, fallback) {
  const translated = safeEnglishValue(translateChinesePhrase(sourceColour), "");
  const constrained = constrainNoonSelectValue("Colour", translated, "");
  if (constrained === translated && translated) return translated;
  return inferColourFamily(sourceColour, translated) || fallback;
}

function stableNoonColourName(sourceColour, fallback) {
  return safeEnglishValue(translateChinesePhrase(sourceColour), fallback);
}

function inferColourFamily(sourceColour, translated = "") {
  const text = `${cleanText(sourceColour)} ${cleanText(translated)}`.toLowerCase();
  const phraseRules = [
    ["Orange", ["橘红", "橙红", "orange red"]],
    ["Red", ["酒红", "枣红", "玫红", "wine red", "rose red", "burgundy"]],
    ["Grey", ["青灰", "blue grey", "blue gray"]],
    ["Pink", ["藕粉", "浅粉", "light pink"]],
    ["Beige", ["卡其", "khaki"]],
  ];
  const rules = [
    ["Multicolour", ["彩", "花色", "multi", "colourful", "colorful"]],
    ["Black", ["黑", "black"]],
    ["White", ["白", "ivory", "white"]],
    ["Grey", ["灰", "grey", "gray"]],
    ["Brown", ["棕", "咖", "褐", "brown", "coffee"]],
    ["Beige", ["米", "杏", "卡其", "beige", "khaki"]],
    ["Red", ["红", "red"]],
    ["Pink", ["粉", "pink", "rose"]],
    ["Blue", ["蓝", "青", "blue", "navy"]],
    ["Green", ["绿", "green"]],
    ["Purple", ["紫", "purple"]],
    ["Gold", ["金", "香槟", "gold", "champagne"]],
    ["Silver", ["银", "silver"]],
    ["Orange", ["橘", "橙", "orange"]],
    ["Yellow", ["黄", "yellow"]],
    ["Clear", ["透明", "clear"]],
  ];

  return (
    phraseRules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ||
    rules.find(([, keywords]) => keywords.some((keyword) => text.includes(keyword)))?.[0] ||
    ""
  );
}

function hoistCommonVariantFields(noonProduct) {
  const variants = Array.isArray(noonProduct.variants) ? noonProduct.variants : [];
  const group = noonProduct.product_group || {};
  const fields = [
    "description_en",
    "description_ar",
    "feature_bullets_en",
    "feature_bullets_ar",
    "length_cm",
    "width_cm",
    "height_cm",
    "actual_weight_kg",
    "vm_weight_cm",
    "price_sar_initial",
    "price_usd",
    "stock",
    "processing_time",
    "warehouse_name",
    "warehouse_code",
    "images",
  ];

  if (variants.length === 0) return;
  for (const field of fields) {
    if (!variants.every((variant) => Object.hasOwn(variant, field))) continue;
    const first = variants[0][field];
    if (!variants.every((variant) => JSON.stringify(variant[field]) === JSON.stringify(first))) continue;
    group[field] = first;
    for (const variant of variants) delete variant[field];
  }
}

function containsChinese(value) {
  return /[\u4e00-\u9fa5]/.test(value);
}

function safeEnglishValue(value, fallback) {
  const text = cleanText(value);
  if (!text || containsChinese(text)) return fallback;
  return text;
}

function cleanTitle(value) {
  return cleanText(value).replace(/\s*[-_]\s*阿里巴巴.*$/i, "");
}

function extractPrice(html) {
  const raw =
    readJsonLikeValue(html, "price") ??
    readJsonLikeValue(html, "discountPrice") ??
    matchFirst(html, /(?:price|价格)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);

  const value = Number.parseFloat(raw);
  if (!Number.isFinite(value)) return null;

  return {
    value,
    currency: "CNY",
    note: "1688 source price; convert manually before noon publishing.",
  };
}

function extractPackageInfo(html) {
  const weight =
    readJsonLikeValue(html, "weight") ??
    readJsonLikeValue(html, "weightG") ??
    matchFirst(html, /(?:重量|weight)[^0-9]{0,20}([0-9]+(?:\.[0-9]+)?)/i);
  const dimensionsText = cleanText(
    matchFirst(
      html,
      /((?:包装信息|商品件重尺|尺寸)[\s\S]{0,400}?\d+(?:\.\d+)?\s*(?:x|\*|×)\s*\d+(?:\.\d+)?\s*(?:x|\*|×)\s*\d+(?:\.\d+)?\s*(?:cm|厘米|公分)?)/i,
    ),
  );

  return {
    weightG: weight ? String(weight) : "",
    dimensionsText,
  };
}

function readMeta(html, name) {
  const escaped = escapeRegExp(name);
  return cleanText(
    matchFirst(
      html,
      new RegExp(`<meta[^>]+(?:property|name)=["']${escaped}["'][^>]+content=["']([^"']*)["']`, "i"),
    ) ??
      matchFirst(
        html,
        new RegExp(`<meta[^>]+content=["']([^"']*)["'][^>]+(?:property|name)=["']${escaped}["']`, "i"),
      ),
  );
}

function readJsonLikeValue(html, key) {
  const escaped = escapeRegExp(key);
  return cleanText(matchFirst(html, new RegExp(`["']${escaped}["']\\s*:\\s*["']([^"']+)["']`, "i")));
}

function findAttribute(attributes, names) {
  const lowerNames = names.map((name) => name.toLowerCase());
  const item = attributes.find((attribute) =>
    lowerNames.some((name) => attribute.name.toLowerCase().includes(name)),
  );

  return item?.value ?? "";
}

function writeJson(filePath, data) {
  return writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

function firstNonEmpty(...values) {
  return values.find((value) => cleanText(value)) ?? "";
}

function logStep(scope, message) {
  console.log(`[${scope}] ${message}`);
}

function logSample(scope, values, limit = 5, label = "样例") {
  for (const [index, value] of values.slice(0, limit).entries()) {
    console.log(`[${scope}] ${label}${index + 1}: ${value}`);
  }
}

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];
    if (!value.startsWith("--") && !parsed.url) {
      parsed.url = value;
      continue;
    }

    if (value.startsWith("--")) {
      const key = value.slice(2);
      parsed[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true";
    }
  }

  return parsed;
}

function isProductDetailUrl(url) {
  return /detail\.1688\.com\/offer\/\d+\.html/i.test(url);
}

function extractProductId(url) {
  return matchFirst(url, /\/offer\/(\d+)\.html/i);
}

function normalizeUrl(value, baseUrl) {
  const cleaned = value.replaceAll("\\/", "/").replace(/^https?:\\\/\\\//, "https://");
  const withProtocol = cleaned.startsWith("//") ? `https:${cleaned}` : cleaned;

  try {
    return new URL(withProtocol, baseUrl).toString().replace(/[?#].*$/, "");
  } catch {
    return withProtocol;
  }
}

function normalizeProductDetailUrl(value, baseUrl) {
  const normalized = normalizeUrl(value, baseUrl);
  const productId = extractProductId(normalized);

  return productId ? `https://detail.1688.com/offer/${productId}.html` : normalized;
}

function normalizeTitle(value) {
  return cleanText(value).replace(/\s*[-_]\s*1688.*$/i, "");
}

function cleanText(value) {
  if (!value) return "";
  return decodeHtml(String(value))
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function decodeHtml(value) {
  return value
    .replace(/&quot;/g, '"')
    .replace(/&#34;/g, '"')
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'");
}

function safeFileName(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, "-")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 120);
}

function buildWarnings(meta) {
  const warnings = [];
  if (!meta.title) warnings.push("Title was not found in the 1688 page.");
  if (meta.imageUrls.length === 0) warnings.push("No product images were found in the 1688 page.");
  return warnings;
}

function matchFirst(value, pattern) {
  return pattern.exec(value)?.[1] ?? "";
}

function unique(values) {
  return [...new Set(values.filter(Boolean).map((value) => normalizeUrl(value)))];
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function shortHash(value) {
  let hash = 0;
  for (const char of value) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return String(hash);
}
