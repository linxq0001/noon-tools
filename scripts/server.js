#!/usr/bin/env node

import { createReadStream, existsSync } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { bulkUpdateFileNames, exportNoonBulkUpdates } from "./lib/noon-bulk-update-exporter.js";
import { readNoonUploadStatusFromProductDir } from "./lib/noon-upload-status.js";
import { readPlatformRepositories } from "./lib/product-storage.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const productsDir = path.join(rootDir, "products");
const exportsDir = path.join(rootDir, "exports");
const uiSettingsPath = path.join(rootDir, ".ui-settings.json");
const default1688Profile = ".cloakbrowser-profile";
const defaultNoonProfile = ".noon-profile";
const port = Number.parseInt(process.env.PORT ?? "4173", 10);
const jobs = new Map();
const uploadJobs = new Map();
const uiSettingKeys = [
  "url",
  "limit",
  "delaySeconds",
  "headless",
  "proxy",
  "repository",
  "noonUrl",
  "noonBrowser",
  "noonCloakTyping",
  "noonHeadless",
  "catalogType",
  "deepSeekModel",
  "deepSeekApiKey",
];

const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, `http://${request.headers.host}`);

    if (request.method === "GET" && url.pathname === "/api/settings") {
      sendJson(response, await readUiSettings());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/settings") {
      sendJson(response, await saveUiSettings(await readJsonBody(request)));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/jobs") {
      await createJob(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/jobs/") && url.pathname.endsWith("/cancel")) {
      cancelJob(jobs, url.pathname.split("/").at(-2), response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/jobs") {
      sendJson(response, [...jobs.values()].map(serializeJob));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/jobs/")) {
      const job = jobs.get(url.pathname.split("/").at(-1));
      if (!job) return notFound(response);
      sendJson(response, serializeJob(job));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/login-1688") {
      await create1688LoginJob(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/noon-generate-jobs") {
      await createNoonGenerateJob(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/upload-jobs") {
      await createUploadJob(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname.startsWith("/api/upload-jobs/") && url.pathname.endsWith("/cancel")) {
      cancelJob(uploadJobs, url.pathname.split("/").at(-2), response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/upload-jobs") {
      sendJson(response, [...uploadJobs.values()].map(serializeJob));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/api/upload-jobs/")) {
      const job = uploadJobs.get(url.pathname.split("/").at(-1));
      if (!job) return notFound(response);
      sendJson(response, serializeJob(job));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/noon-status") {
      await checkNoonStatus(url, response);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/noon-upload-status") {
      sendJson(response, readNoonUploadStatus(url.searchParams.get("productDir")));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/products") {
      sendJson(response, await listRepositories());
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/noon-bulk-updates") {
      await createNoonBulkUpdateFiles(request, response);
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/products/")) {
      await serveFile(response, productsDir, decodeURIComponent(url.pathname.replace(/^\/products\//, "")));
      return;
    }

    if (request.method === "GET" && url.pathname.startsWith("/exports/")) {
      await serveFile(response, exportsDir, decodeURIComponent(url.pathname.replace(/^\/exports\//, "")));
      return;
    }

    const filePath = url.pathname === "/" ? "index.html" : decodeURIComponent(url.pathname.slice(1));
    await serveFile(response, publicDir, filePath);
  } catch (error) {
    sendJson(response, { error: error.message }, 500);
  }
});

server.listen(port, () => {
  console.log(`Noon tools UI: http://localhost:${port}`);
});

async function createJob(request, response) {
  const body = await readJsonBody(request);
  const url = String(body.url || "").trim();

  if (url && !/^https?:\/\/.+1688\.com\//i.test(url)) {
    sendJson(response, { error: "请输入有效的 1688 链接。" }, 400);
    return;
  }

  const running1688Job = findRunning1688Job();
  if (running1688Job) {
    sendJson(
      response,
      { error: `已有 1688 任务正在运行：${running1688Job.kind}。请等待完成或先停止当前任务。` },
      409,
    );
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const args = ["scripts/collect-1688.js"];

  if (url) args.push(url);

  args.push("--out", "products");

  if (body.limit !== undefined) args.push("--limit", String(body.limit));
  if (body.delaySeconds) args.push("--delay-seconds", String(body.delaySeconds));
  if (body.repository) args.push("--repository", body.repository);
  if (body.headless === false) args.push("--headless", "false");
  if (body.deepSeekApiKey) args.push("--deepseek", "true");
  args.push("--profile", default1688Profile);
  if (body.proxy) args.push("--proxy", body.proxy);
  const env = { ...process.env };
  if (body.deepSeekApiKey) env.DEEPSEEK_API_KEY = String(body.deepSeekApiKey);
  if (body.deepSeekModel) env.DEEPSEEK_MODEL = String(body.deepSeekModel);

  const job = {
    id,
    kind: "collect1688",
    status: "running",
    url: url || "collection-queue.json",
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    child: null,
  };

  jobs.set(id, job);

  const child = spawn(process.execPath, args, { cwd: rootDir, env });
  job.child = child;
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("close", (code) => {
    if (job.status === "cancelled") return;
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });

  sendJson(response, serializeJob(job), 201);
}

async function create1688LoginJob(request, response) {
  const body = await readJsonBody(request);
  const running1688Job = findRunning1688Job();
  if (running1688Job) {
    sendJson(
      response,
      { error: `已有 1688 任务正在运行：${running1688Job.kind}。请等待完成或先停止当前任务。` },
      409,
    );
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const loginUrl = body.url && /^https?:\/\/.+1688\.com\//i.test(body.url) ? body.url : "https://www.1688.com/";
  const args = ["scripts/login-1688.js", "--url", loginUrl];

  args.push("--profile", default1688Profile);

  const job = {
    id,
    kind: "login1688",
    status: "running",
    url: loginUrl,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    child: null,
  };

  jobs.set(id, job);

  const child = spawn(process.execPath, args, { cwd: rootDir, env: process.env });
  job.child = child;
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("close", (code) => {
    if (job.status === "cancelled") return;
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });

  sendJson(response, serializeJob(job), 201);
}

async function createUploadJob(request, response) {
  const body = await readJsonBody(request);

  if (!body.noonUrl || !/^https?:\/\//i.test(body.noonUrl)) {
    sendJson(response, { error: "请输入有效的 noon Add Product 链接。" }, 400);
    return;
  }

  const productDirs = Array.isArray(body.productDirs) ? body.productDirs.map(String).filter(Boolean) : [];

  if (!body.all && !body.productDir && productDirs.length === 0) {
    sendJson(response, { error: "请选择一个商品目录，或选择全部上传。" }, 400);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const args = ["scripts/upload-noon.js", "--noon-url", body.noonUrl];

  if (body.all) {
    args.push("--all");
  } else if (productDirs.length > 0) {
    args.push("--product-dirs", JSON.stringify(productDirs.map((productDir) => `products/${productDir}`)));
  } else {
    args.push("--product-dir", `products/${body.productDir}`);
  }

  args.push("--profile", defaultNoonProfile);
  args.push("--browser", body.noonBrowser || "cloak");
  if (body.noonCloakTyping === true || body.noonCloakTyping === "true") args.push("--cloak-typing", "true");
  if (body.headless === true) args.push("--headless", "true");
  if (body.manualWaitMs) args.push("--manual-wait-ms", String(body.manualWaitMs));

  const job = {
    id,
    status: "running",
    url: body.noonUrl,
    productDir: body.productDir ?? "",
    productDirs,
    repository: body.all ? "" : repositoryFromProductDir(productDirs[0] || body.productDir || ""),
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    child: null,
  };

  uploadJobs.set(id, job);

  const child = spawn(process.execPath, args, { cwd: rootDir, env: process.env });
  job.child = child;
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("close", async (code) => {
    if (job.status === "cancelled") return;
    job.exitCode = code;
    if (code === 0 || hasSuccessfulUploadedProducts(job)) await recordSuccessfulGlobalBulkUpdates(job);
    job.status = code === 0 ? "completed" : "failed";
    job.finishedAt = new Date().toISOString();
  });

  sendJson(response, serializeJob(job), 201);
}

async function createNoonGenerateJob(request, response) {
  const body = await readJsonBody(request);

  if (!body.productDir) {
    sendJson(response, { error: "请选择一个商品目录。" }, 400);
    return;
  }

  const metaPath = safeProductFilePath(body.productDir, "meta.json");

  try {
    await stat(metaPath);
  } catch {
    sendJson(response, { error: `找不到 meta.json: products/${body.productDir}` }, 400);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const args = [
    "scripts/collect-1688.js",
    "--from-meta",
    path.relative(rootDir, metaPath),
    "--deepseek",
    "true",
  ];
  const env = { ...process.env };

  if (body.deepSeekApiKey) env.DEEPSEEK_API_KEY = String(body.deepSeekApiKey);
  if (body.deepSeekModel) env.DEEPSEEK_MODEL = String(body.deepSeekModel);

  const job = {
    id,
    kind: "generateNoonProduct",
    status: "running",
    url: `products/${body.productDir}/meta.json`,
    productDir: body.productDir,
    startedAt: new Date().toISOString(),
    finishedAt: null,
    exitCode: null,
    logs: [],
    child: null,
  };

  jobs.set(id, job);

  const child = spawn(process.execPath, args, { cwd: rootDir, env });
  job.child = child;
  child.stdout.on("data", (chunk) => appendLog(job, chunk));
  child.stderr.on("data", (chunk) => appendLog(job, chunk));
  child.on("close", (code) => {
    if (job.status === "cancelled") return;
    job.status = code === 0 ? "completed" : "failed";
    job.exitCode = code;
    job.finishedAt = new Date().toISOString();
  });

  sendJson(response, serializeJob(job), 201);
}

async function createNoonBulkUpdateFiles(request, response) {
  const body = await readJsonBody(request);
  const repository = cleanPathSegment(body.repository || "");
  const catalogType = cleanPathSegment(body.catalogType || "global");
  if (repository.includes("..") || path.isAbsolute(repository)) {
    sendJson(response, { error: "仓库路径不合法。" }, 400);
    return;
  }
  if (!["noon", "supermall", "global"].includes(catalogType)) {
    sendJson(response, { error: "商品目录类型不合法。" }, 400);
    return;
  }
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const exportKey = repository || "all";
  const exportName = repository ? `${stamp}-${catalogType}-${repository.replaceAll("/", "-")}` : `${stamp}-${catalogType}-all`;
  const outputDir = catalogType === "global"
    ? globalBulkUpdateOutputDir(exportKey)
    : path.join(exportsDir, "noon-bulk-updates", exportName);
  const result = await exportNoonBulkUpdates({ productsDir, outputDir, repository, catalogType });
  const files = catalogType === "global"
    ? globalBulkUpdateFileUrls(exportKey)
    : timestampedBulkUpdateFileUrls(exportName);

  sendJson(response, {
    skuCount: result.skuCount,
    productCount: result.productCount,
    catalogType,
    duplicateProducts: result.duplicateProducts,
    duplicateSkus: result.duplicateSkus,
    files,
  });
}

async function recordSuccessfulGlobalBulkUpdates(job) {
  try {
    const repository = cleanPathSegment(job.repository || "");
    const exportKey = repository || "all";
    const outputDir = globalBulkUpdateOutputDir(exportKey);
    const result = await exportNoonBulkUpdates({ productsDir, outputDir, repository, catalogType: "global" });
    const files = globalBulkUpdateFileUrls(exportKey);

    job.globalBulkUpdate = {
      repository,
      skuCount: result.skuCount,
      productCount: result.productCount,
      files,
    };

    appendLog(
      job,
      `Global 批量更新表已记录 ${result.productCount} 个商品、${result.skuCount} 个 SKU：${files.product} / ${files.price} / ${files.stock}`,
    );
  } catch (error) {
    appendLog(job, `Global 批量更新表记录失败：${error.message}`);
  }
}

function globalBulkUpdateFileUrls(exportKey) {
  const baseUrl = `/exports/noon-bulk-updates/global/${encodeURIComponent(exportKey)}`;
  return {
    product: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.product)}`,
    price: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.price)}`,
    stock: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.stock)}`,
  };
}

function globalBulkUpdateOutputDir(exportKey) {
  return path.join(exportsDir, "noon-bulk-updates", "global", exportKey);
}

function timestampedBulkUpdateFileUrls(exportName) {
  const baseUrl = `/exports/noon-bulk-updates/${encodeURIComponent(exportName)}`;
  return {
    product: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.product)}`,
    price: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.price)}`,
    stock: `${baseUrl}/${encodeURIComponent(bulkUpdateFileNames.stock)}`,
  };
}

async function checkNoonStatus(url, response) {
  const noonUrl = url.searchParams.get("noonUrl");
  const profile = defaultNoonProfile;

  if (!noonUrl || !/^https?:\/\//i.test(noonUrl)) {
    sendJson(response, { error: "请输入有效的 noon Add Product 链接。" }, 400);
    return;
  }

  const child = spawn(process.execPath, ["scripts/check-noon-status.js", "--noon-url", noonUrl, "--profile", profile], {
    cwd: rootDir,
    env: process.env,
  });

  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString("utf8");
  });
  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString("utf8");
  });
  child.on("close", () => {
    const lines = stdout.split(/\r?\n/).filter(Boolean);
    const jsonLine = lines.findLast((line) => line.trim().startsWith("{"));

    if (!jsonLine) {
      sendJson(response, { status: "error", loggedIn: false, uploadPageReachable: false, error: stderr || stdout }, 500);
      return;
    }

    sendJson(response, JSON.parse(jsonLine));
  });
}

function findRunning1688Job() {
  return [...jobs.values()].find(
    (job) => (job.kind === "collect1688" || job.kind === "login1688") && job.status === "running",
  );
}

function cancelJob(store, id, response) {
  const job = store.get(id);
  if (!job) return notFound(response);

  if (job.status !== "running") {
    sendJson(response, serializeJob(job));
    return;
  }

  job.status = "cancelled";
  job.exitCode = null;
  job.finishedAt = new Date().toISOString();
  appendLog(job, "任务已手动停止。");
  job.child?.kill("SIGTERM");

  setTimeout(() => {
    if (job.child && !job.child.killed) job.child.kill("SIGKILL");
  }, 5000).unref();

  sendJson(response, serializeJob(job));
}

function safeProductFilePath(productDir, fileName) {
  const fullPath = path.resolve(productsDir, productDir, fileName);
  const basePath = `${productsDir}${path.sep}`;

  if (!fullPath.startsWith(basePath)) {
    throw new Error("商品目录路径不合法。");
  }

  return fullPath;
}

function cleanPathSegment(value) {
  return String(value || "").replace(/^\/+|\/+$/g, "");
}

function repositoryFromProductDir(value) {
  const parts = cleanPathSegment(value).split("/").filter(Boolean);
  if (parts.length === 0) return "";
  if (parts[0] === "1688") return parts[1] || "default";
  if (parts.length === 1) return "default";
  return parts[0];
}

async function readUiSettings() {
  try {
    return sanitizeUiSettings(JSON.parse(await readFile(uiSettingsPath, "utf8")));
  } catch {
    return {};
  }
}

async function saveUiSettings(values) {
  const current = await readUiSettings();
  const next = {
    ...current,
    ...sanitizeUiSettings(values),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(uiSettingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");

  return next;
}

function sanitizeUiSettings(values) {
  const settings = {};

  for (const key of uiSettingKeys) {
    if (values?.[key] !== undefined) settings[key] = String(values[key]);
  }

  return settings;
}

function appendLog(job, chunk) {
  const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
  job.logs.push(...lines.map((line) => ({ time: new Date().toISOString(), line })));
  job.logs = job.logs.slice(-300);
}

async function listProducts() {
  const repositories = await listRepositories();
  return repositories.flatMap((repository) => repository.products);
}

async function listRepositories() {
  const repositories = await readPlatformRepositories(productsDir, "1688");
  const summaries = [];

  for (const repository of repositories) {
    const products = [];
    for (const productDir of repository.productDirs) {
      products.push(await readProductSummary(productDir.relativeDir, repository.id));
    }
    summaries.push(buildRepositorySummary(repository.id, repository.name, products));
  }

  return summaries.sort((left, right) => String(right.updatedAt).localeCompare(String(left.updatedAt)));
}

async function readProductSummary(relativeDir, repository) {
  const metaPath = path.join(productsDir, relativeDir, "meta.json");

  try {
    const meta = JSON.parse(await readFile(metaPath, "utf8"));
    const noonSummary = await readNoonProductSummary(relativeDir);
    const firstImage = Array.isArray(meta.images) ? meta.images[0] : "";
    const firstLocalImage =
      typeof firstImage === "string"
        ? firstImage
        : firstImage?.path || (meta.downloadedCount > 0 ? "001.jpg" : "");

    return {
      dirName: relativeDir,
      repository,
      title: meta.title || path.basename(relativeDir),
      sourceUrl: meta.sourceUrl ?? meta.source?.url ?? "",
      price: meta.price,
      imageCount: meta.downloadedCount ?? meta.images?.length ?? 0,
      generatedAt: meta.generatedAt ?? "",
      warnings: meta.parseWarnings ?? [],
      coverImage: firstLocalImage ? productFileUrl(relativeDir, firstLocalImage) : "",
      metaUrl: productFileUrl(relativeDir, "meta.json"),
      noonUrl: productFileUrl(relativeDir, "noon-product-attributes.json"),
      noonSummary,
      noonUploadStatus: readNoonUploadStatus(relativeDir),
    };
  } catch {
    return {
      dirName: relativeDir,
      repository,
      title: path.basename(relativeDir),
      imageCount: 0,
      warnings: ["meta.json 不可读取"],
      noonUploadStatus: readNoonUploadStatus(relativeDir),
    };
  }
}

async function readNoonProductSummary(relativeDir) {
  try {
    const product = JSON.parse(await readFile(path.join(productsDir, relativeDir, "noon-product-attributes.json"), "utf8"));

    if (product.product_group) {
      const variants = Array.isArray(product.variants) ? product.variants : [];
      const hasOfferPrices = variants.length > 0 && variants.every((variant) => hasValue(variant.price_sar_initial ?? variant.price));
      const blockingIssues = (product.submission_gate?.blockingIssues || []).filter(
        (issue) => !(hasOfferPrices && issue.includes("Source price is CNY")),
      );

      return {
        title: product.product_group.product_group_name_en || "",
        variantCount: variants.length,
        imageCount: Math.max(...variants.map((variant) => (variant.images || []).length), 0),
        gateStatus: blockingIssues.length > 0 ? product.submission_gate?.status || "" : "ready_for_manual_review",
        blockingIssues,
        warnings: product.submission_gate?.warnings || [],
        sourcePrice: product.submission_gate?.sourcePrice || null,
        blockingCount: blockingIssues.length,
      };
    }

    return {
      title: product.productIdentity?.englishTitle || "",
      variantCount: product.offerDetails?.offers?.length || 1,
      imageCount: product.productIdentity?.productImages?.length || 0,
      gateStatus: "",
      blockingCount: 0,
    };
  } catch {
    return {
      title: "",
      variantCount: 0,
      imageCount: 0,
      gateStatus: "missing_noon_attributes",
      blockingCount: 1,
    };
  }
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function buildRepositorySummary(id, name, products) {
  return {
    id,
    name,
    productCount: products.length,
    imageCount: products.reduce((sum, product) => sum + (product.imageCount || 0), 0),
    uploadableCount: products.filter((product) => (product.noonSummary?.imageCount || 0) > 0).length,
    blockedCount: products.filter((product) => (product.noonSummary?.blockingCount || 0) > 0).length,
    updatedAt: products[0]?.generatedAt || "",
    uploadStatus: readNoonUploadStatus(id),
    globalBulkUpdate: readGlobalBulkUpdateStatus(id),
    products,
  };
}

function productFileUrl(relativeDir, filename) {
  return `/products/${[...relativeDir.split("/"), ...String(filename).split("/")].map(encodeURIComponent).join("/")}`;
}

function readNoonUploadStatus(productDir) {
  const relativeDir = cleanPathSegment(productDir || "");
  try {
    return readNoonUploadStatusFromProductDir(path.dirname(safeProductFilePath(relativeDir, "meta.json")), relativeDir);
  } catch {
    return readNoonUploadStatusFromProductDir(path.join(productsDir, "__missing__"), relativeDir);
  }
}

function hasSuccessfulUploadedProducts(job) {
  return uploadJobProductDirs(job).some((productDir) => readNoonUploadStatus(productDir).uploaded);
}

function uploadJobProductDirs(job) {
  if (Array.isArray(job.productDirs) && job.productDirs.length > 0) return job.productDirs;
  if (job.productDir) return [job.productDir];
  return [];
}

function readGlobalBulkUpdateStatus(repository) {
  const exportKey = repository || "all";
  const outputDir = globalBulkUpdateOutputDir(exportKey);
  const files = globalBulkUpdateFileUrls(exportKey);

  return {
    available: existsSync(path.join(outputDir, bulkUpdateFileNames.product)),
    files,
  };
}

async function readJsonBody(request) {
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  if (chunks.length === 0) return {};
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

async function serveFile(response, baseDir, requestedPath) {
  const fullPath = path.resolve(baseDir, requestedPath);
  const basePath = `${baseDir}${path.sep}`;

  if (fullPath !== baseDir && !fullPath.startsWith(basePath)) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  let fileStat;
  try {
    fileStat = await stat(fullPath);
  } catch {
    return notFound(response);
  }

  if (!fileStat.isFile()) return notFound(response);

  response.writeHead(200, { "content-type": contentType(fullPath) });
  createReadStream(fullPath).pipe(response);
}

function serializeJob(job) {
  return {
    id: job.id,
    kind: job.kind,
    status: job.status,
    url: job.url,
    productDir: job.productDir ?? "",
    productDirs: job.productDirs ?? [],
    repository: job.repository ?? "",
    globalBulkUpdate: job.globalBulkUpdate ?? null,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    exitCode: job.exitCode,
    logs: job.logs,
  };
}

function sendJson(response, data, status = 200) {
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(data));
}

function notFound(response) {
  response.writeHead(404);
  response.end("Not found");
}

function contentType(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".html") return "text/html; charset=utf-8";
  if (ext === ".css") return "text/css; charset=utf-8";
  if (ext === ".js") return "text/javascript; charset=utf-8";
  if (ext === ".json") return "application/json; charset=utf-8";
  if (ext === ".png") return "image/png";
  if (ext === ".webp") return "image/webp";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  return "application/octet-stream";
}
