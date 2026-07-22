#!/usr/bin/env node

import { createReadStream, existsSync } from "node:fs";
import { readFile, readdir, stat, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { applyBulkOperation } from "./lib/noon-bulk-operations.js";
import {
  bulkUpdateFileNames,
  exportNoonBulkUpdates,
  verifyBulkUpdatePartnerSkus,
} from "./lib/noon-bulk-update-exporter.js";
import { checkNoonProducts, writeOperationCheck } from "./lib/noon-operation-checks.js";
import { handleNoonStoreApi } from "./lib/noon-store-api.js";
import {
  buildNoonCatalogSyncArgs,
  buildNoonLoginArgs,
  buildNoonStatusArgs,
  buildNoonUploadIdentityArgs,
  normalizeCatalogMode,
} from "./lib/noon-store-jobs.js";
import { findNoonStore } from "./lib/noon-stores.js";
import {
  defaultNoonUploadStatus,
  readStoreNoonUploadStatusFromProductDir,
} from "./lib/noon-upload-status.js";
import { summarizeNoonProduct } from "./lib/noon-product-summary.js";
import {
  findRepositoryProductBySku,
  listRepositoryProducts,
  listRepositorySummaries,
  normalizeProductPageParams,
  productDirsForRepository,
} from "./lib/product-listing.js";
import { readPlatformRepositories } from "./lib/product-storage.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const publicDir = path.join(rootDir, "public");
const productsDir = path.join(rootDir, "products");
const exportsDir = path.join(rootDir, "exports");
const uiSettingsPath = path.join(rootDir, ".ui-settings.json");
const default1688Profile = ".cloakbrowser-profile";
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
  "noonBrowser",
  "noonCloakTyping",
  "noonHeadless",
  "catalogType",
  "deepSeekModel",
  "deepSeekApiKey",
  "defaultStoreId",
  "globalExchangeRate",
  "globalPlatformFeeRate",
  "globalTargetMargin",
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

    const storeLoginMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/login$/);
    if (request.method === "POST" && storeLoginMatch) {
      await createNoonStoreLoginJob(decodeURIComponent(storeLoginMatch[1]), response);
      return;
    }

    const storeStatusMatch = url.pathname.match(/^\/api\/stores\/([^/]+)\/status$/);
    if (request.method === "GET" && storeStatusMatch) {
      await checkNoonStoreStatus(decodeURIComponent(storeStatusMatch[1]), response);
      return;
    }

    if (url.pathname === "/api/stores" || url.pathname.startsWith("/api/stores/")) {
      const settings = await readUiSettings();
      const storeResult = await handleNoonStoreApi({
        method: request.method,
        pathname: url.pathname,
        body: request.method === "POST" ? await readJsonBody(request) : {},
        rootDir,
        productsDir,
        getDefaultStoreId: () => settings.defaultStoreId || "",
        setDefaultStoreId,
      });
      if (!storeResult.handled) return notFound(response);
      sendJson(response, storeResult.body, storeResult.status);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/noon-generate-jobs") {
      await createNoonGenerateJob(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/noon-catalog-sync-jobs") {
      await createNoonCatalogSyncJob(request, response);
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

    if (request.method === "GET" && url.pathname === "/api/noon-upload-status") {
      sendJson(response, readNoonUploadStatus(url.searchParams.get("productDir"), url.searchParams.get("storeId") || ""));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/repositories") {
      sendJson(response, await listRepositorySummaries({
        productsDir,
        storeId: url.searchParams.get("storeId") || "",
        readProductSummary,
        buildRepositorySummary,
      }));
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/products") {
      const repositoryId = url.searchParams.get("repository") || "";
      if (!repositoryId) {
        sendJson(response, { error: "缺少仓库参数。" }, 400);
        return;
      }

      const params = normalizeProductPageParams({
        page: url.searchParams.get("page"),
        pageSize: url.searchParams.get("pageSize"),
        status: url.searchParams.get("status"),
        q: url.searchParams.get("q"),
      });
      const result = await listRepositoryProducts({
        productsDir,
        repositoryId,
        storeId: url.searchParams.get("storeId") || "",
        ...params,
        readProductSummary,
      });

      if (!result) return notFound(response);
      sendJson(response, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/products/resolve") {
      const result = await findRepositoryProductBySku({
        productsDir,
        partnerSku: url.searchParams.get("partnerSku") || "",
        sku: url.searchParams.get("sku") || "",
        storeId: url.searchParams.get("storeId") || "",
        readProductSummary,
        readProductSkus,
      });

      if (!result) return notFound(response);
      sendJson(response, result);
      return;
    }

    if (request.method === "GET" && url.pathname === "/api/noon-catalog-sync") {
      sendJson(response, await readLatestNoonCatalogSync({
        storeId: url.searchParams.get("storeId") || "",
        mode: url.searchParams.get("mode") || "global",
      }));
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/noon-bulk-updates") {
      await createNoonBulkUpdateFiles(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/operation-checks") {
      await createOperationChecks(request, response);
      return;
    }

    if (request.method === "POST" && url.pathname === "/api/bulk-operations") {
      await createBulkOperation(request, response);
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

async function createNoonStoreLoginJob(storeId, response) {
  const store = await findNoonStore(rootDir, storeId);
  if (!store) {
    sendJson(response, { error: "找不到 noon 店铺。" }, 404);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const args = buildNoonLoginArgs(rootDir, store);
  const job = {
    id,
    kind: "loginNoon",
    status: "running",
    url: args[args.indexOf("--noon-url") + 1],
    storeId: store.id,
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
  const repository = cleanPathSegment(body.repository || "");
  let productDirs = Array.isArray(body.productDirs) ? body.productDirs.map(String).filter(Boolean) : [];
  if (!body.all && repository && productDirs.length === 0 && !body.productDir) {
    productDirs = await productDirsForRepository({ productsDir, repositoryId: repository });
  }

  if (!body.all && !body.productDir && productDirs.length === 0) {
    sendJson(response, { error: "请选择一个商品目录、仓库，或选择全部上传。" }, 400);
    return;
  }

  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const storeId = String(body.storeId || "").trim();

  if (!storeId) {
    sendJson(response, { error: "请选择一个 noon 店铺。" }, 400);
    return;
  }

  const store = await findNoonStore(rootDir, storeId);
  if (!store) {
    sendJson(response, { error: "找不到 noon 店铺。" }, 404);
    return;
  }

  const args = ["scripts/upload-noon.js", ...buildNoonUploadIdentityArgs(rootDir, store)];

  if (body.all) {
    args.push("--all");
  } else if (productDirs.length > 0) {
    args.push("--product-dirs", JSON.stringify(productDirs.map((productDir) => `products/${productDir}`)));
  } else {
    args.push("--product-dir", `products/${body.productDir}`);
  }

  args.push("--browser", body.noonBrowser || "cloak");
  if (body.noonCloakTyping === true || body.noonCloakTyping === "true") args.push("--cloak-typing", "true");
  if (body.headless === true) args.push("--headless", "true");
  if (body.manualWaitMs) args.push("--manual-wait-ms", String(body.manualWaitMs));

  const job = {
    id,
    status: "running",
    url: args[args.indexOf("--noon-url") + 1],
    productDir: body.productDir ?? "",
    productDirs,
    repository: body.all ? "" : repository || repositoryFromProductDir(productDirs[0] || body.productDir || ""),
    storeId: store.id,
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

async function createNoonCatalogSyncJob(request, response) {
  const body = await readJsonBody(request);
  const storeId = String(body.storeId || "").trim();
  if (!storeId) {
    sendJson(response, { error: "请选择一个 noon 店铺。" }, 400);
    return;
  }

  const store = await findNoonStore(rootDir, storeId);
  if (!store) {
    sendJson(response, { error: "找不到 noon 店铺。" }, 404);
    return;
  }

  const mode = normalizeCatalogMode(body.mode || "global");
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const args = buildNoonCatalogSyncArgs(rootDir, store, mode);
  const job = {
    id,
    kind: "syncNoonCatalog",
    status: "running",
    url: args[args.indexOf("--catalog-url") + 1],
    mode,
    storeId: store.id,
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
    skippedProducts: result.skippedProducts,
    files,
  });
}

async function createOperationChecks(request, response) {
  const body = await readJsonBody(request);
  const productDirs = sanitizeProductDirs(body.productDirs);
  if (productDirs.length === 0) throw new Error("请选择要检查的商品。");

  const result = await checkNoonProducts({
    productsDir,
    productDirs,
    profitConfig: profitConfigFromBody(body),
  });

  for (const check of result.checked) {
    if (check.status !== "blocked" || check.blockingIssues.some((issue) => issue.code !== "missing_noon_attributes")) {
      try {
        await writeOperationCheck(productsDir, check);
      } catch {
        // Missing or unreadable noon attributes are already represented in the check result.
      }
    }
  }

  sendJson(response, result);
}

async function createBulkOperation(request, response) {
  const body = await readJsonBody(request);
  const productDirs = sanitizeProductDirs(body.productDirs);
  if (productDirs.length === 0) throw new Error("请选择要操作的商品。");

  const checks = await checkNoonProducts({
    productsDir,
    productDirs,
    profitConfig: profitConfigFromBody(body),
  });
  const operationCheckByProductDir = Object.fromEntries(checks.checked.map((check) => [check.productDir, check]));
  const operationResult = await applyBulkOperation({
    productsDir,
    productDirs,
    operation: sanitizeBulkOperation(body.operation),
    operationCheckByProductDir,
  });

  const repository = cleanPathSegment(body.repository || "");
  const catalogType = cleanPathSegment(body.catalogType || "global");
  if (!["noon", "supermall", "global"].includes(catalogType)) throw new Error("商品目录类型不合法。");
  const exportKey = repository === "__default__" ? "default" : repository || "all";
  const outputDir = globalBulkUpdateOutputDir(exportKey);
  const exportResult = await exportNoonBulkUpdates({
    productsDir,
    outputDir,
    platform: "1688",
    repository: exportKey === "all" ? "" : exportKey,
    catalogType,
  });

  sendJson(response, {
    checks,
    operation: operationResult,
    export: exportResult,
    files: globalBulkUpdateFileUrls(exportKey),
  });
}

async function recordSuccessfulGlobalBulkUpdates(job) {
  try {
    const repository = cleanPathSegment(job.repository || "");
    const exportKey = repository || "all";
    const outputDir = globalBulkUpdateOutputDir(exportKey);
    const uploaded = await uploadedPartnerSkusForJob(job);
    if (uploaded.expectedSkus.length === 0) {
      appendLog(job, "Global 批量更新表跳过：未找到本次成功上传的 SKU。");
      return;
    }
    const result = await exportNoonBulkUpdates({
      productsDir,
      outputDir,
      repository,
      catalogType: "global",
      productDirs: Object.keys(uploaded.partnerSkuByProductDir),
      partnerSkuByProductDir: uploaded.partnerSkuByProductDir,
      append: true,
    });
    const skuVerification = verifyBulkUpdatePartnerSkus(result.files, uploaded.expectedSkus);
    const files = globalBulkUpdateFileUrls(exportKey);

    job.globalBulkUpdate = {
      repository,
      skuCount: result.skuCount,
      productCount: result.productCount,
      files,
      skuVerification,
    };

    appendLog(
      job,
      `Global 批量更新表已记录 ${result.productCount} 个商品、${result.skuCount} 个 SKU：${files.product} / ${files.price} / ${files.stock}`,
    );
    if (skuVerification.ok) {
      appendLog(job, `Global 批量更新表 SKU 校验通过：${skuVerification.expectedSkus.join(", ") || "无已上传 SKU"}`);
    } else {
      appendLog(
        job,
        `Global 批量更新表 SKU 校验失败：${skuVerification.missing.map((item) => `${item.file}:${item.partnerSku}`).join(", ")}`,
      );
    }
  } catch (error) {
    appendLog(job, `Global 批量更新表记录失败：${error.message}`);
  }
}

async function uploadedPartnerSkusForJob(job) {
  const productDirs = await uploadedProductDirsForJob(job);
  const partnerSkuByProductDir = {};

  for (const productDir of productDirs) {
    const partnerSkus = readUploadedPartnerSkus(productDir, job.storeId || "");
    if (partnerSkus.length > 0) partnerSkuByProductDir[productDir] = partnerSkus;
  }

  return {
    partnerSkuByProductDir,
    expectedSkus: [...new Set(Object.values(partnerSkuByProductDir).flat())],
  };
}

async function uploadedProductDirsForJob(job) {
  const productDirs = uploadJobProductDirs(job);
  if (productDirs.length > 0) return productDirs;

  const repositories = await readPlatformRepositories(productsDir, "1688");
  return repositories.flatMap((repository) => repository.productDirs.map((productDir) => productDir.relativeDir));
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

async function checkNoonStoreStatus(storeId, response) {
  const store = await findNoonStore(rootDir, storeId);
  if (!store) {
    sendJson(response, { error: "找不到 noon 店铺。" }, 404);
    return;
  }

  const child = spawn(process.execPath, buildNoonStatusArgs(rootDir, store), {
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

async function setDefaultStoreId(value) {
  await saveUiSettings({ defaultStoreId: value || "" });
}

function sanitizeUiSettings(values) {
  const settings = {};

  for (const key of uiSettingKeys) {
    if (values?.[key] !== undefined) settings[key] = String(values[key]);
  }

  return settings;
}

function sanitizeProductDirs(productDirs) {
  return (Array.isArray(productDirs) ? productDirs : [])
    .map((dir) => cleanPathSegment(dir))
    .filter(Boolean);
}

function sanitizeBulkOperation(operation = {}) {
  const type = String(operation.type || "");
  if (type === "set_price") return { type, priceUsd: operation.priceUsd };
  if (type === "set_stock") return { type, stock: operation.stock };
  if (type === "deactivate") return { type };
  if (type === "set_processing_time") return { type, processingTime: operation.processingTime };
  throw new Error("不支持的批量操作。");
}

function profitConfigFromBody(body = {}) {
  return {
    costCny: body.costCny,
    shippingCny: body.shippingCny,
    exchangeRate: body.exchangeRate,
    platformFeeRate: body.platformFeeRate,
    targetMargin: body.targetMargin,
  };
}

function appendLog(job, chunk) {
  const lines = chunk.toString("utf8").split(/\r?\n/).filter(Boolean);
  job.logs.push(...lines.map((line) => ({ time: new Date().toISOString(), line })));
  job.logs = job.logs.slice(-300);
}

async function readLatestNoonCatalogSync({ storeId = "", mode = "global" } = {}) {
  const normalizedMode = normalizeCatalogMode(mode);
  const normalizedStoreId = String(storeId || "").trim().toUpperCase();
  const syncDir = path.join(exportsDir, "noon-catalog-sync");

  let fileNames = [];
  try {
    fileNames = await readdir(syncDir);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const candidates = fileNames
    .filter((fileName) => fileName.endsWith(`-${normalizedMode}.json`))
    .sort()
    .reverse();

  for (const fileName of candidates) {
    try {
      const sync = JSON.parse(await readFile(path.join(syncDir, fileName), "utf8"));
      if (normalizedStoreId && String(sync.storeId || "").toUpperCase() !== normalizedStoreId) continue;
      if (normalizeCatalogMode(sync.mode || normalizedMode) !== normalizedMode) continue;
      const headers = Array.isArray(sync.headers) ? sync.headers : [];
      return {
        synced: true,
        storeId: sync.storeId || normalizedStoreId,
        mode: normalizedMode,
        catalogUrl: sync.catalogUrl || "",
        title: sync.title || "",
        headers,
        rows: sanitizeNoonCatalogRows(sync.rows, headers),
        output: `/exports/noon-catalog-sync/${encodeURIComponent(fileName)}`,
        fileName,
      };
    } catch {
      // Ignore broken snapshots and keep looking for an older usable one.
    }
  }

  return {
    synced: false,
    storeId: normalizedStoreId,
    mode: normalizedMode,
    catalogUrl: "",
    title: "",
    headers: [],
    rows: [],
    output: "",
    fileName: "",
  };
}

function sanitizeNoonCatalogRows(rows, headers = []) {
  const headerText = headers.map(cleanCatalogCellText).join("|");
  return (Array.isArray(rows) ? rows : [])
    .map(normalizeNoonCatalogRow)
    .filter(Boolean)
    .filter((row) => row.cells.length > 0)
    .filter((row) => row.cells.join("|") !== headerText);
}

function normalizeNoonCatalogRow(row) {
  if (Array.isArray(row)) {
    return {
      cells: row.map(cleanCatalogCellText).filter(Boolean),
      imageUrl: "",
    };
  }
  if (!row || typeof row !== "object") return null;
  return {
    cells: (Array.isArray(row.cells) ? row.cells : []).map(cleanCatalogCellText).filter(Boolean),
    imageUrl: cleanCatalogCellText(row.imageUrl),
  };
}

function cleanCatalogCellText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

async function readProductSummary(relativeDir, repository, storeId = "") {
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
      noonUploadStatus: readNoonUploadStatus(relativeDir, storeId),
    };
  } catch {
    return {
      dirName: relativeDir,
      repository,
      title: path.basename(relativeDir),
      imageCount: 0,
      warnings: ["meta.json 不可读取"],
      noonUploadStatus: readNoonUploadStatus(relativeDir, storeId),
    };
  }
}

async function readNoonProductSummary(relativeDir) {
  try {
    const product = JSON.parse(await readFile(path.join(productsDir, relativeDir, "noon-product-attributes.json"), "utf8"));
    return summarizeNoonProduct(product, {
      imageUrl: (image) => productImageUrl(relativeDir, image),
    });
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

async function readProductSkus(relativeDir, storeId = "") {
  const skus = new Set(readUploadedPartnerSkus(relativeDir, storeId));
  try {
    const product = JSON.parse(await readFile(path.join(productsDir, relativeDir, "noon-product-attributes.json"), "utf8"));
    for (const variant of Array.isArray(product.variants) ? product.variants : []) {
      [variant.partner_sku, variant.model_number, variant.barcode].forEach((value) => {
        const sku = String(value || "").trim();
        if (sku) skus.add(sku);
      });
    }
  } catch {
    // Missing attributes means there is nothing to resolve for this product.
  }
  return [...skus];
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

function productImageUrl(relativeDir, image) {
  return /^https?:\/\//i.test(String(image || "")) ? image : productFileUrl(relativeDir, image);
}

function readNoonUploadStatus(productDir, storeId = "") {
  const relativeDir = cleanPathSegment(productDir || "");
  try {
    const fullProductDir = path.dirname(safeProductFilePath(relativeDir, "meta.json"));
    return storeId
      ? readStoreNoonUploadStatusFromProductDir(fullProductDir, relativeDir, storeId)
      : defaultNoonUploadStatus(relativeDir);
  } catch {
    return storeId
      ? readStoreNoonUploadStatusFromProductDir(path.join(productsDir, "__missing__"), relativeDir, storeId)
      : defaultNoonUploadStatus(relativeDir);
  }
}

function hasSuccessfulUploadedProducts(job) {
  return uploadJobProductDirs(job).some((productDir) => readUploadedPartnerSkus(productDir, job.storeId || "").length > 0);
}

function readUploadedPartnerSkus(productDir, storeId = "") {
  const status = readNoonUploadStatus(productDir, storeId);
  return [
    ...new Set([
      ...(Array.isArray(status.partnerSkus) ? status.partnerSkus : []),
      status.uploaded ? status.partnerSku : "",
    ].map((sku) => String(sku || "").trim()).filter(Boolean)),
  ];
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
    storeId: job.storeId ?? "",
    mode: job.mode ?? "",
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
