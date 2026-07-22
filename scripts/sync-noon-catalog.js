#!/usr/bin/env node

import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeNoonBrowserError } from "./lib/noon-browser-errors.js";
import { normalizeCatalogMode } from "./lib/noon-store-jobs.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const mode = normalizeCatalogMode(args.mode || "global");
const catalogUrl = args.catalogUrl ?? args["catalog-url"] ?? "https://noon-catalog.noon.partners/";
const profile = args.profile ?? ".noon-profile";
const storeId = args.storeId ?? args["store-id"] ?? "";

try {
  const result = await syncNoonCatalog({ catalogUrl, profile, storeId, mode });
  console.log(JSON.stringify(result));
} catch (error) {
  console.log(
    JSON.stringify({
      status: "error",
      mode,
      storeId,
      catalogUrl,
      error: normalizeNoonBrowserError(error, profile),
      syncedAt: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
}

async function syncNoonCatalog({ catalogUrl, profile, storeId, mode }) {
  const { launchPersistentContext } = await importCloakBrowser();
  const context = await launchPersistentContext({
    userDataDir: path.resolve(rootDir, profile),
    headless: args.headless === "false" ? false : true,
    locale: "en-US",
    timezone: "Asia/Dubai",
    viewport: { width: 1440, height: 960 },
    humanize: true,
    humanPreset: "careful",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());
    console.log("打开 Noon Catalog 页面...");
    await page.goto(catalogUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(3000);

    if (/login\.noon\.partners/i.test(page.url())) {
      throw new Error("Noon Catalog 未登录，请先在店铺管理里完成登录。");
    }

    console.log(`切换到 ${mode === "global" ? "Global (NGS)" : "FBN/FBP"} 模式...`);
    await selectCatalogMode(page, mode);
    await page.waitForTimeout(2500);

    console.log("读取 SKU 表格，正在获取总页数...");
    const data = await collectCatalogRows(page);

    console.log(`写入同步快照，共 ${data.rows.length} 条 SKU 数据...`);
    const output = await writeSyncSnapshot({ storeId, mode, catalogUrl: page.url(), data });
    return {
      status: "completed",
      mode,
      storeId,
      catalogUrl,
      finalUrl: page.url(),
      rowCount: data.rows.length,
      output,
      syncedAt: new Date().toISOString(),
    };
  } finally {
    await context.close();
  }
}

async function selectCatalogMode(page, mode) {
  const labels = mode === "global" ? [/Global/i, /NGS/i] : [/FBN/i, /FBP/i];
  for (const label of labels) {
    const button = page.getByText(label).first();
    try {
      if (await button.isVisible({ timeout: 2000 })) {
        await button.click({ timeout: 5000 });
        return;
      }
    } catch {
      // Some Noon Catalog accounts land directly in the selected mode.
    }
  }
}

async function collectCatalogRows(page) {
  await waitForCatalogRows(page);
  const headers = await readCatalogHeaders(page);
  const rows = [];
  const seen = new Set();
  const totalPages = await readCatalogTotalPages(page);
  const maxPages = Number(args.maxPages ?? args["max-pages"] ?? totalPages ?? 200);
  let pageNumber = 1;

  while (pageNumber <= maxPages) {
    await page.waitForTimeout(800);
    const pageRows = await readCatalogPageRows(page, headers);
    for (const row of pageRows) {
      const key = row.cells.join("|");
      if (!key || seen.has(key)) continue;
      seen.add(key);
      rows.push(row);
    }

    const totalLabel = totalPages ? `/${totalPages}` : "";
    console.log(`正在同步第 ${pageNumber}${totalLabel} 页，累计 ${rows.length} 条 SKU 数据...`);
    if (totalPages && pageNumber >= totalPages) break;

    const moved = await clickCatalogNextPage(page, pageNumber);
    if (!moved) break;
    pageNumber += 1;
  }

  const bodyText = await page.evaluate(() => document.body?.innerText ?? "");
  return {
    title: await page.title(),
    textSample: bodyText.replace(/\s+/g, " ").slice(0, 1200),
    headers,
    rows,
    totalPages: totalPages || pageNumber,
  };
}

async function waitForCatalogRows(page) {
  try {
    await page.waitForFunction(() => {
      const bodyText = document.body?.innerText || "";
      return /PSKU:\s*\S+/i.test(bodyText) && /SKU:\s*\S+/i.test(bodyText);
    }, null, { timeout: 30000 });
  } catch {
    // Keep going so the saved snapshot and logs still explain what was visible.
  }
}

async function readCatalogHeaders(page) {
  return page.evaluate(() => {
    return [...document.querySelectorAll("table th, [role='columnheader']")]
      .map((node) => node.innerText?.replace(/\s+/g, " ").trim())
      .filter(Boolean);
  });
}

async function readCatalogPageRows(page, headers = []) {
  return page.evaluate((headerValues) => {
    const headerText = headerValues.join("|");
    return [...document.querySelectorAll("table tbody tr, [role='row'], [class*='row'], [class*='product']")]
      .map((row) => {
        const image = row.querySelector("img");
        const imageUrl = image?.currentSrc || image?.src || "";
        const cells = [...row.querySelectorAll("td, [role='cell']")]
          .map((cell) => cell.innerText?.replace(/\s+/g, " ").trim())
          .filter(Boolean);
        const rowText = row.innerText?.replace(/\s+/g, " ").trim() || "";
        if (cells.length === 0 && /PSKU:\s*\S+/i.test(rowText) && /SKU:\s*\S+/i.test(rowText)) {
          return { cells: [rowText], imageUrl };
        }
        return { cells, imageUrl };
      })
      .filter((row) => row.cells.length > 0)
      .filter((row) => /PSKU:\s*\S+/i.test(row.cells.join(" ")) && /SKU:\s*\S+/i.test(row.cells.join(" ")))
      .filter((row) => row.cells.join("|") !== headerText);
  }, headers);
}

async function readCatalogTotalPages(page) {
  return page.evaluate(() => {
    const pageNumbers = [...document.querySelectorAll(".ant-pagination-item, [class*='pagination'] button, [aria-label*='page' i]")]
      .map((node) => {
        const text = node.getAttribute("title") || node.getAttribute("aria-label") || node.innerText?.trim() || "";
        const match = text.match(/\d+/);
        return match ? Number(match[0]) : NaN;
      })
      .filter(Number.isFinite);
    return pageNumbers.length ? Math.max(...pageNumbers) : 0;
  });
}

async function clickCatalogNextPage(page, pageNumber) {
  const before = await catalogPageSignature(page);
  const navigated = await gotoCatalogPage(page, pageNumber + 1, before);
  if (navigated) return true;

  const clicked = await page.evaluate(() => {
    const candidates = [
      ".ant-pagination-next:not(.ant-pagination-disabled) button",
      ".ant-pagination-next:not(.ant-pagination-disabled)",
      "button[aria-label='Next Page']",
      "button[aria-label='next']",
      "button[title='Next Page']",
      "[aria-label='right']:not([disabled])",
    ];
    for (const selector of candidates) {
      const element = document.querySelector(selector);
      if (!element) continue;
      const disabled = element.disabled || element.getAttribute("aria-disabled") === "true" || element.classList.contains("disabled");
      if (disabled) continue;
      element.click();
      return true;
    }
    const buttons = [...document.querySelectorAll("button, [role='button']")];
    const next = buttons.find((button) => /^(next|›|>)$/i.test(button.innerText?.trim() || ""));
    if (!next || next.disabled || next.getAttribute("aria-disabled") === "true") return false;
    next.click();
    return true;
  });

  if (!clicked) return false;
  try {
    await page.waitForFunction((previous) => {
      const rows = [...document.querySelectorAll("table tbody tr, [role='row'], [class*='row'], [class*='product']")]
        .map((row) => row.innerText?.replace(/\s+/g, " ").trim())
        .filter((text) => /PSKU:\s*\S+/i.test(text) && /SKU:\s*\S+/i.test(text));
      return rows.join("|").slice(0, 1000) !== previous;
    }, before, { timeout: 12000 });
  } catch {
    return false;
  }
  return true;
}

async function gotoCatalogPage(page, pageNumber, previousSignature) {
  try {
    const nextUrl = new URL(page.url());
    nextUrl.searchParams.set("page", String(pageNumber));
    if (!nextUrl.searchParams.has("limit")) nextUrl.searchParams.set("limit", "20");
    await page.goto(nextUrl.href, { waitUntil: "domcontentloaded", timeout: 90000 });
    await waitForCatalogRows(page);
    await page.waitForFunction((previous) => {
      const rows = [...document.querySelectorAll("table tbody tr, [role='row'], [class*='row'], [class*='product']")]
        .map((row) => row.innerText?.replace(/\s+/g, " ").trim())
        .filter((text) => /PSKU:\s*\S+/i.test(text) && /SKU:\s*\S+/i.test(text));
      return rows.join("|").slice(0, 1000) !== previous;
    }, previousSignature, { timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

async function catalogPageSignature(page) {
  return page.evaluate(() => {
    const rows = [...document.querySelectorAll("table tbody tr, [role='row'], [class*='row'], [class*='product']")]
      .map((row) => row.innerText?.replace(/\s+/g, " ").trim())
      .filter((text) => /PSKU:\s*\S+/i.test(text) && /SKU:\s*\S+/i.test(text));
    return rows.join("|").slice(0, 1000);
  });
}

async function writeSyncSnapshot({ storeId, mode, catalogUrl, data }) {
  const outputDir = path.join(rootDir, "exports", "noon-catalog-sync");
  await mkdir(outputDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const fileName = `${stamp}-${storeId || "store"}-${mode}.json`;
  const relativePath = path.join("exports", "noon-catalog-sync", fileName);
  await writeFile(
    path.join(rootDir, relativePath),
    `${JSON.stringify({ storeId, mode, catalogUrl, ...data }, null, 2)}\n`,
    "utf8",
  );
  return `/${relativePath.split(path.sep).map(encodeURIComponent).join("/")}`;
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

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2).replace(/-([a-z])/g, (_, char) => char.toUpperCase());
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return parsed;
}
