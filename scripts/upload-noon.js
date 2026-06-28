#!/usr/bin/env node

import { access, appendFile, readdir, readFile } from "node:fs/promises";
import { accessSync } from "node:fs";
import path from "node:path";
import { createInterface } from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createSellerLabFieldIssues } from "./lib/seller-lab-field-issues.js";
import { createSellerLabPageAdapter } from "./lib/seller-lab-page-adapter.js";
import { createSellerLabPageOperations } from "./lib/seller-lab-page-operations.js";
import { brandCandidates, isNoBrandValue } from "./lib/noon-brand.js";
import { noonSelectConstraints, normalizeNoonSelectValue } from "./lib/noon-field-constraints.js";
import { regenerateProductIdentities } from "./lib/noon-product-identity.js";
import { normalizeNoonStoreId } from "./lib/noon-stores.js";
import { prepareNoonUploadProducts } from "./lib/noon-upload-product.js";
import { acquireStoreUploadLock, assertStoreUploadAllowed } from "./lib/noon-upload-preflight.js";
import { writeStoreNoonUploadStatus } from "./lib/noon-upload-status.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const productsDir = path.join(rootDir, "products");
const args = parseArgs(process.argv.slice(2));
const manualWaitMs = Number.parseInt(args.manualWaitMs ?? "600000", 10);
const fieldIssues = createSellerLabFieldIssues();

if (!args.noonUrl) {
  fail("Usage: npm run upload:noon -- --product-dir products/example --noon-url <Add Product URL> [--profile .noon-profile] [--headless false]\n       npm run upload:noon -- --all --noon-url <Add Product URL> [--profile .noon-profile] [--headless false]");
}

if (!args.all && !args.productDir && !args.productDirs) {
  fail("Missing --product-dir <dir>, --product-dirs <json-array>, or --all.");
}

if (!args.storeId) {
  fail("Missing --store-id <id>.");
}

const storeId = normalizeNoonStoreId(args.storeId);

const productDirs = args.all
  ? await listProductDirs()
  : args.productDirs
    ? parseProductDirs(args.productDirs).map(resolveProductDir)
    : [resolveProductDir(args.productDir)];
if (productDirs.length === 0) fail("No product directories found.");

await regenerateProductIdentities(productsDir);

const products = [];
let hadFailure = false;
let skippedProducts = 0;
for (const productDir of productDirs) {
  try {
    products.push(...(await loadProducts(productDir)));
  } catch (error) {
    if (!args.all) hadFailure = true;
    skippedProducts += 1;
    logStep("product", `${path.basename(productDir)}: skipped`);
    logStep("error", error.message);
  }
}

if (products.length === 0) fail("No valid products to upload.");

if (args.validateOnly === "true") {
  logStep("validate", `${products.length} valid product(s), ${skippedProducts} skipped product(s).`);
  process.exit(0);
}

const browser = await createBrowser();

try {
  for (const product of products) {
    try {
      await uploadProduct(product);
    } catch (error) {
      hadFailure = true;
      logStep("error", error.message);
    }
  }
} finally {
  await browser.close();
}

if (hadFailure) process.exitCode = 1;

async function listProductDirs() {
  const productDirs = [];

  await collectProductDirs(productsDir, productDirs);

  return productDirs;
}

async function collectProductDirs(dir, productDirs) {
  let entries = [];

  try {
    await access(path.join(dir, "meta.json"));
    productDirs.push(dir);
    return;
  } catch {}

  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (entry.isDirectory()) await collectProductDirs(path.join(dir, entry.name), productDirs);
  }
}

function resolveProductDir(value) {
  const productDir = path.isAbsolute(value) ? path.resolve(value) : path.resolve(rootDir, value);
  if (productDir !== rootDir && productDir.startsWith(`${rootDir}${path.sep}`)) return productDir;
  fail(`Product directory must be inside this project: ${value}`);
}

function parseProductDirs(value) {
  try {
    const parsed = JSON.parse(value);
    if (Array.isArray(parsed) && parsed.length > 0) return parsed.map(String);
  } catch {}

  return String(value).split(",").map((item) => item.trim()).filter(Boolean);
}

async function uploadProduct(product) {
  const name = path.basename(product.productDir);
  let page = null;
  let lock = null;
  let failed = false;
  let keepPageOpenOnFailure = false;
  fieldIssues.reset();

  try {
    logStep("product", `${name}: running`);
    await assertStoreUploadAllowed({
      productDir: product.productDir,
      relativeDir: product.relativeDir,
      storeId,
      product,
      productsDir,
    });
    lock = await acquireStoreUploadLock(product.productDir, storeId, product.productIdentity.partnerSku);
    await writeStoreNoonUploadStatus(product.productDir, {
      productDir: product.relativeDir,
      status: "uploading",
      updatedAt: new Date().toISOString(),
      partnerSku: product.productIdentity.partnerSku,
      message: "Add Product 正在上传。",
    }, storeId);

    page = await browser.newPage();
    warnRawContent(product);
    const sellerLabPage = createSellerLabPageAdapter(createSellerLabPageOperations(page, sellerLabPageHelpers()));

    keepPageOpenOnFailure = await sellerLabPage.openCreatePage(() => {
      keepPageOpenOnFailure = true;
    });
    keepPageOpenOnFailure = true;

    await sellerLabPage.fillProductIdentity(product);
    await sellerLabPage.continueFromProductIdentity(product);

    await sellerLabPage.fillProductContent(product);
    fieldIssues.assertClear("Product Content");

    if (args.stopAfterDetailedContent === "true") {
      await fillDetailedContent(page, product);
      fieldIssues.assertClear("Detailed Content");
      logStep("test", "已填完 Detailed Content，按测试要求暂停，不进入 Offer Details。请检查打开的页面；完成后在 UI 点停止任务。");
      await waitForStopAfterDetailedContent(page);
      return;
    }

    await sellerLabPage.fillDetailedContent(product);
    fieldIssues.assertClear("Detailed Content");

    if (args.stopAfterOfferDetails === "true") {
      await fillOfferDetails(page, product);
      fieldIssues.assertClear("Offer Details");
      logStep("test", "已填完 Offer Details，按测试要求暂停，不提交也不关闭页面。完成后在 UI 点停止任务。");
      await waitForOpenPage(page, "Offer Details");
      return;
    }

    await sellerLabPage.submitOfferDetails(product);
    fieldIssues.assertClear("Offer Details");

    await writeStoreNoonUploadStatus(product.productDir, {
      productDir: product.relativeDir,
      status: "uploaded",
      uploadedAt: new Date().toISOString(),
      partnerSku: product.productIdentity.partnerSku,
      message: "Add Product 上传成功，已提交 Offer Details。",
    }, storeId);
    logStep("product", `${name}: submitted`);
  } catch (error) {
    failed = true;
    logStep("product", `${name}: failed`);
    await writeStoreNoonUploadStatus(product.productDir, {
      productDir: product.relativeDir,
      status: "failed",
      failedAt: new Date().toISOString(),
      partnerSku: product.productIdentity?.partnerSku,
      message: String(error?.message || error),
    }, storeId).catch(() => {});
    throw error;
  } finally {
    if (lock) await lock.release().catch(() => {});
    if (page && args.keepOpen !== "true" && !(failed && keepPageOpenOnFailure)) await page.close().catch(() => {});
  }
}

function sellerLabPageHelpers() {
  return {
    gotoNoonCreatePage,
    waitForReady,
    waitForUploadPage,
    fillRequiredField,
    fillOptionalField,
    selectBrand,
    uploadImages,
    prepareProductCategory,
    clickButton,
    waitForStep,
    fillProductContent,
    fillDetailedContent,
    fillOfferDetails,
  };
}

async function loadProducts(productDir) {
  const productPath = path.join(productDir, "noon-product-attributes.json");
  await access(productDir).catch(() => {
    throw new Error(`Product directory does not exist: ${productDir}`);
  });
  await access(productPath).catch(() => {
    throw new Error(`Missing noon-product-attributes.json: ${productPath}`);
  });

  const rawProduct = JSON.parse(await readFile(productPath, "utf8"));
  const uploadProducts = await prepareNoonUploadProducts(rawProduct, productDir, storeId);
  const relativeDir = path.relative(productsDir, productDir);

  return Promise.all(uploadProducts.map(async (product) => {
    const imageNames = product.productIdentity?.productImages ?? [];

    if (!product.productIdentity?.englishTitle) throw new Error(`Missing English Title in ${productPath}.`);
    if (!product.productIdentity?.partnerSku) throw new Error(`Missing Partner SKU in ${productPath}.`);
    if (imageNames.length === 0) throw new Error(`Missing product images in ${productPath}.`);

    const imagePaths = [];
    for (const imageName of imageNames.slice(0, 9)) {
      const imagePath = path.resolve(productDir, imageName);
      await access(imagePath).catch(() => {
        throw new Error(`Image does not exist: ${imagePath}`);
      });
      imagePaths.push(imagePath);
    }

    return { ...product, productDir, relativeDir, imagePaths };
  }));
}

function warnRawContent(product) {
  const title = product.productIdentity?.englishTitle ?? "";
  const currency = product.offerDetails?.offers?.[0]?.currency ?? "";

  if (/[\u3400-\u9fff]/.test(title)) logStep("warning", "标题包含中文：当前按原样上传，可能影响 noon 审核。");
  if (currency && currency !== "AED") logStep("warning", `价格币种为 ${currency}：当前按原样上传。`);
}

async function fillProductContent(page, product) {
  const content = product.productContent ?? {};
  await fillFeatureBullets(page, content.featureBullets ?? []);
  await fillOptionalField(page, "Long Description", content.longDescription);
  await fillOptionalField(page, "Arabic Long Description", content.arabicLongDescription, { blocking: false });
  await selectOptionalField(page, "Gender", content.gender, { blocking: false });
  await fillOptionalField(page, "GTIN", content.gtin, { blocking: false });
}

async function fillDetailedContent(page, product) {
  const details = product.detailedContent ?? {};
  await fillOptionalField(page, "Year", details.year, { blocking: false });
  await fillDetailedFeatures(page, details.features ?? [], { blocking: false });

  const selectFields = new Map([
    ["Care Instructions", details.careInstructions],
    ["Casing", details.casing],
    ["Closure", details.closure],
    ["Type", details.type],
    ["Colour", details.colour],
    ["Country of Origin", details.countryOfOrigin],
    ["Exterior Material", details.exteriorMaterial],
    ["Interior Material", details.interiorMaterial],
    ["Item Condition", details.itemCondition],
    ["Style", details.style],
    ["Occasion", details.occasion],
    ["Pattern", details.pattern],
    ["Size Unit", details.sizeUnit],
    ["Strap Material", details.strapMaterial],
  ]);

  for (const [label, value] of selectFields) {
    await selectOptionalField(page, label, value, { blocking: false });
  }

  const fields = new Map([
    ["Colour Name", details.colourName],
    ["Model Number", details.modelNumber],
    ["Model Name", details.modelName],
    ["Size", details.size],
    ["What's In The Box", details.whatsInTheBox],
    ["Product Height", details.productHeight],
    ["Product Length", details.productLength],
    ["Product Width", details.productWidth],
    ["Product Weight", details.productWeight],
    ["HS Code", details.hsCode],
  ]);

  for (const [label, value] of fields) {
    await fillOptionalField(page, label, value);
  }

  await selectDimensionUnits(page, details);
}

async function selectDimensionUnits(page, details) {
  const units = [
    ["Product Height", "Product Height Unit", details.productHeightUnit ?? "cm"],
    ["Product Length", "Product Length Unit", details.productLengthUnit ?? "cm"],
    ["Product Weight", "Product Weight Unit", details.productWeightUnit ?? "kg"],
    ["Product Width", "Product Width Unit", details.productWidthUnit ?? "cm"],
  ];

  for (const [index, [rowLabel, logLabel, value]] of units.entries()) {
    await selectUnitDropdown(page, value, index, logLabel, rowLabel);
  }
}

async function selectUnitDropdown(page, value, occurrence, label = `Unit ${occurrence + 1}`, rowLabel = "") {
  const text = normalizeNoonSelectValue("Unit", value);
  const clicked = await page.evaluate(({ rowIndex, rowLabelText }) => {
    const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const controls = [...document.querySelectorAll(".ant-select, [aria-haspopup=listbox]")]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect(), text: clean(element.textContent) }))
      .filter(({ rect, text }) => text.includes("unit") || /^(mm|cm|m|in|ft|kg|g|gram|kilogram)$/.test(text) || (rect.width <= 180 && rect.left > window.innerWidth * 0.55))
      .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

    let control = null;
    if (rowLabelText) {
      const target = clean(rowLabelText);
      const labels = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent) === target)
        .sort((left, right) => {
          const leftRect = left.getBoundingClientRect();
          const rightRect = right.getBoundingClientRect();
          return leftRect.top - rightRect.top || clean(left.textContent).length - clean(right.textContent).length;
        });
      const rowLabel = labels[0];
      if (rowLabel) {
        const labelRect = rowLabel.getBoundingClientRect();
        const labelCenterY = labelRect.top + labelRect.height / 2;
        control = controls
          .filter(({ rect }) => rect.left > labelRect.right && Math.abs(rect.top + rect.height / 2 - labelCenterY) < 36)
          .sort((left, right) => {
            const leftCenterY = left.rect.top + left.rect.height / 2;
            const rightCenterY = right.rect.top + right.rect.height / 2;
            return Math.abs(leftCenterY - labelCenterY) - Math.abs(rightCenterY - labelCenterY) || left.rect.left - right.rect.left;
          })[0]?.element;
      }
    }

    control ??= controls[rowIndex]?.element;
    if (!control) return null;
    control.scrollIntoView({ block: "center", inline: "center" });
    const rect = control.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }, { rowIndex: occurrence, rowLabelText: rowLabel });

  if (!clicked) {
    logStep("warning", `${label}: control not found, skipped`);
    return false;
  }

  await page.mouse.click(clicked.x, clicked.y);

  try {
    await waitForAnySelectDropdown(page, 2500);
    await recordVisibleSelectOptions(page, label);
    await clickSelectOption(page, text);
    await page.waitForTimeout(500);
    logStep("field", `${label}: selected "${text}"`);
    return true;
  } catch {
    const optionsText = await readVisibleSelectOptions(page).catch(() => []);
    await page.keyboard.press("Escape").catch(() => {});
    logStep(
      "warning",
      `${label}: option not found for "${text}"${optionsText.length ? `; visible options: ${optionsText.join(" | ")}` : ""}`,
    );
    await recordSelectMismatch(label, text, optionsText);
    return false;
  }
}

async function fillOfferDetails(page, product) {
  const offer = product.offerDetails?.offers?.[0] ?? {};
  await fillOptionalField(page, "Partner SKU", offer.partnerSku || product.productIdentity?.partnerSku);
  await fillOptionalField(page, "Price", offer.price);
  await selectOptionalField(page, "Currency", offer.currency, { blocking: false });
  await fillOptionalField(page, "Barcode", offer.barcode);
  await fillOptionalField(page, "Warehouse", offer.warehouse);
  await fillOptionalField(page, "Stock", offer.stock);
}

async function fillRequiredField(page, label, value) {
  if (!hasValue(value)) throw new Error(`Required value is empty: ${label}`);
  const filled = await fillField(page, label, value);
  if (!filled) throw new Error(`Required field not found: ${label}`);
  logStep("field", `${label}: filled ${formatLogValue(value)}`);
}

async function fillOptionalField(page, label, value, options = {}) {
  if (!hasValue(value)) return false;
  const filled = await fillField(page, label, value, options);
  if (filled) {
    logStep("field", `${label}: filled ${formatLogValue(value)}`);
  } else {
    logStep("warning", `${label}: not filled or page did not keep the value`);
    if (options.blocking !== false) recordFieldIssue(label);
  }
  return filled;
}

async function waitForStopAfterDetailedContent(page) {
  await waitForOpenPage(page, "Detailed Content");
}

async function waitForOpenPage(page, label) {
  while (!page.isClosed()) {
    await page.waitForTimeout(30000);
    logStep("test", `${label} 页面保持打开中；完成检查后在 UI 点停止任务。`);
  }
}

function formatLogValue(value) {
  const text = String(value).replace(/\s+/g, " ").trim();
  const clipped = text.length > 120 ? `${text.slice(0, 117)}...` : text;
  return `"${clipped}"`;
}

async function fillFeatureBullets(page, bullets) {
  const values = bullets.filter(hasValue).slice(0, 5);
  if (values.length === 0) return;

  for (const [index, value] of values.entries()) {
    if (await fillFeatureBulletAtIndex(page, index, value)) {
      logStep("field", `Feature Bullet ${index + 1}: filled ${formatLogValue(value)}`);
    } else {
      logStep("warning", `Feature Bullet ${index + 1}: not found`);
      break;
    }

    if (index < values.length - 1) {
      const beforeCount = await countFeatureBulletRows(page);
      if (!(await addFeatureBulletRow(page, beforeCount))) {
        break;
      }
    }
  }
}

async function addFeatureBulletRow(page, beforeCount) {
  if (!(await clickAddNewForField(page, "Feature Bullet"))) {
    logStep("warning", "Feature Bullet: Add New button not found");
    return false;
  }

  logStep("field", "Feature Bullet: Add New");
  let increased = await waitForFeatureBulletRows(page, beforeCount + 1);
  if (!increased) {
    increased = await clickAddNewForFieldDom(page, "Feature Bullet", beforeCount + 1);
  }

  const rows = await countFeatureBulletRows(page);
  logStep("field", `Feature Bullet rows: ${rows}`);
  if (!increased) {
    logStep("warning", `Feature Bullet: Add New clicked but row count stayed at ${beforeCount}`);
    return false;
  }

  return true;
}

async function fillDetailedFeatures(page, features, options = {}) {
  const values = features.filter(hasValue);
  if (values.length === 0) return;

  for (let index = await countFieldRows(page, "Features", ["Care Instructions"]); index < values.length; index += 1) {
    if (await clickAddNewForField(page, "Features")) {
      logStep("field", "Features: Add New");
      await waitForFieldRows(page, "Features", ["Care Instructions"], index + 1);
    } else {
      logStep("warning", "Features: Add New button not found");
      break;
    }
  }

  logStep("field", `Features rows: ${await countFieldRows(page, "Features", ["Care Instructions"])}`);
  for (const [index, value] of values.entries()) {
    const constrained = normalizeNoonSelectValue("Features", value);
    if (!selectValueSatisfiesConstraint("Features", constrained)) {
      logStep("warning", `Features ${index + 1}: value does not satisfy constraint ${formatLogValue(constrained)}`);
      await recordSelectMismatch("Features", constrained, noonSelectConstraints.Features ?? []);
      continue;
    }

    if (await selectRepeaterOptionAtIndex(page, "Features", ["Care Instructions"], index, constrained)) {
      logStep("field", `Features ${index + 1}: selected ${formatLogValue(constrained)} (constraint ok, page verified)`);
    } else {
      logStep("warning", `Features ${index + 1}: option not selected for ${formatLogValue(constrained)}`);
      await recordSelectMismatch("Features", constrained, await readVisibleSelectOptions(page).catch(() => []));
      if (options.blocking !== false) recordFieldIssue("Features");
    }
  }
}

function selectValueSatisfiesConstraint(label, value) {
  const allowed = noonSelectConstraints[label];
  if (!allowed) return true;
  const normalized = String(value || "").trim().toLowerCase();
  return allowed.some((option) => option.toLowerCase() === normalized);
}

async function selectRepeaterOptionAtIndex(page, label, nextLabels, index, value) {
  const text = normalizeNoonSelectValue(label, value);
  const clicked = await page.evaluate(
    ({ labelText, nextLabelTexts, rowIndex }) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const label = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes(clean(labelText)))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];
      if (!label) return null;

      const labelRect = label.getBoundingClientRect();
      const nextTop =
        [...document.querySelectorAll("label, div, span, p")]
          .filter((element) => visible(element) && nextLabelTexts.some((nextLabel) => clean(element.textContent).includes(clean(nextLabel))))
          .map((element) => element.getBoundingClientRect().top)
          .filter((top) => top > labelRect.top)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
      const controls = [...document.querySelectorAll(".ant-select-selector, [role=combobox], [aria-haspopup=listbox]")]
        .filter(visible)
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: clean(element.textContent) }))
        .filter(({ rect }) => rect.top >= labelRect.top - 12 && rect.top < nextTop && rect.left > labelRect.left)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      const control = controls[rowIndex]?.element;
      if (!control) return null;

      control.scrollIntoView({ block: "center", inline: "center" });
      const rect = control.getBoundingClientRect();
      return {
        x: rect.left + Math.max(24, rect.width - 36),
        y: rect.top + rect.height / 2,
      };
    },
    { labelText: label, nextLabelTexts: nextLabels, rowIndex: index },
  );

  if (!clicked) return false;

  await page.mouse.click(clicked.x, clicked.y);
  await page.waitForTimeout(300);
  await recordVisibleSelectOptions(page, label);

  try {
    await waitForAnySelectDropdown(page, 1500);
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await typeSelectSearchText(page, text);
    await waitForSelectOption(page, text, 2500);
    await clickSelectOption(page, text);
  } catch {
    await page.keyboard.press("Enter").catch(() => {});
  }

  await page.waitForTimeout(500);
  await page.keyboard.press("Escape").catch(() => {});
  return isRepeaterOptionSelected(page, label, nextLabels, index, text);
}

async function isRepeaterOptionSelected(page, label, nextLabels, index, value) {
  return page.evaluate(
    ({ labelText, nextLabelTexts, rowIndex, expectedValue }) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const label = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes(clean(labelText)))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];
      if (!label) return false;

      const labelRect = label.getBoundingClientRect();
      const nextTop =
        [...document.querySelectorAll("label, div, span, p")]
          .filter((element) => visible(element) && nextLabelTexts.some((nextLabel) => clean(element.textContent).includes(clean(nextLabel))))
          .map((element) => element.getBoundingClientRect().top)
          .filter((top) => top > labelRect.top)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
      const controls = [...document.querySelectorAll(".ant-select-selector, [role=combobox], [aria-haspopup=listbox], input, textarea")]
        .filter(visible)
        .map((element) => ({ element, rect: element.getBoundingClientRect(), text: clean(`${element.textContent || ""} ${element.value || ""}`) }))
        .filter(({ rect }) => rect.top >= labelRect.top - 12 && rect.top < nextTop && rect.left > labelRect.left)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
      const text = controls[rowIndex]?.text ?? "";
      return text.includes(clean(expectedValue));
    },
    { labelText: label, nextLabelTexts: nextLabels, rowIndex: index, expectedValue: value },
  );
}

async function fillRepeaterTextAtIndex(page, label, nextLabels, index, value) {
  return page.evaluate(
    ({ labelText, nextLabelTexts, rowIndex, textValue }) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const setValue = (input) => {
        input.focus();
        if (input.isContentEditable) {
          input.textContent = textValue;
        } else {
          const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (setter) setter.call(input, textValue);
          else input.value = textValue;
        }
        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: textValue }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
        input.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "Enter" }));
        input.blur();
        return true;
      };

      const label = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes(clean(labelText)))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];
      if (!label) return false;

      const labelRect = label.getBoundingClientRect();
      const nextTop =
        [...document.querySelectorAll("label, div, span, p")]
          .filter((element) => visible(element) && nextLabelTexts.some((nextLabel) => clean(element.textContent).includes(clean(nextLabel))))
          .map((element) => element.getBoundingClientRect().top)
          .filter((top) => top > labelRect.top)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
      const inputs = [...document.querySelectorAll("input:not([type=file]), textarea, [contenteditable=true]")]
        .filter(visible)
        .map((input) => ({ input, rect: input.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= labelRect.top - 12 && rect.top < nextTop)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

      return inputs[rowIndex]?.input ? setValue(inputs[rowIndex].input) : false;
    },
    { labelText: label, nextLabelTexts: nextLabels, rowIndex: index, textValue: String(value) },
  );
}

async function countFieldRows(page, label, nextLabels = []) {
  return page.evaluate(
    ({ labelText, nextLabelTexts }) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const label = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes(clean(labelText)))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];
      if (!label) return 0;

      const labelRect = label.getBoundingClientRect();
      const nextTop =
        [...document.querySelectorAll("label, div, span, p")]
          .filter((element) => visible(element) && nextLabelTexts.some((nextLabel) => clean(element.textContent).includes(clean(nextLabel))))
          .map((element) => element.getBoundingClientRect().top)
          .filter((top) => top > labelRect.top)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;

      return [...document.querySelectorAll("input[role=combobox], input[type=search]")]
        .filter(visible)
        .map((element) => element.getBoundingClientRect())
        .filter((rect) => rect.top >= labelRect.top - 12 && rect.top < nextTop).length;
    },
    { labelText: label, nextLabelTexts: nextLabels },
  );
}

async function waitForFieldRows(page, label, nextLabels, expectedCount) {
  const deadline = Date.now() + 2500;

  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    if ((await countFieldRows(page, label, nextLabels)) >= expectedCount) return true;
  }

  return false;
}

async function fillFreeformSelectField(page, label, value, options = {}) {
  const text = String(value);

  if (!(await clickFieldControl(page, label, { ...options, forceMouse: true }))) return false;

  await page.waitForTimeout(250);
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await typeSelectSearchText(page, text);
    await page.keyboard.press("Enter").catch(() => {});
  await page.waitForTimeout(500);
  await page.keyboard.press("Escape").catch(() => {});

  return isSelectValueSelected(page, label, text, options);
}

async function insertFocusedText(page, text) {
  if (shouldSimulateCloakTyping()) {
    await page.keyboard.type(String(text), { delay: 20 });
    return;
  }

  const assigned = await page.evaluate((nextValue) => {
    const element = document.activeElement;
    if (
      !element ||
      !(
        element instanceof HTMLInputElement ||
        element instanceof HTMLTextAreaElement ||
        element.isContentEditable
      )
    ) {
      return false;
    }

    const value = String(nextValue ?? "");
    if (element.isContentEditable) {
      element.textContent = value;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, value);
      else element.value = value;
    }
    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }, String(text));

  if (assigned) return;

  try {
    await page.keyboard.insertText(String(text));
    return;
  } catch {
    await page.keyboard.type(String(text), { delay: 0 });
  }
}

async function typeSelectSearchText(page, text) {
  if (shouldSimulateCloakTyping()) {
    await page.keyboard.type(String(text), { delay: 20 });
    return;
  }

  try {
    await page.keyboard.insertText(String(text));
  } catch {
    await page.keyboard.type(String(text), { delay: 0 });
  }
}

async function setLocatorValue(page, locator, value) {
  if (shouldSimulateCloakTyping()) {
    await locator.click({ timeout: 2500 });
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await page.keyboard.type(String(value), { delay: 20 });
    await locator.evaluate((element) => element.blur?.()).catch(() => {});
    return;
  }

  await locator.evaluate((element, nextValue) => {
    const text = String(nextValue ?? "");

    element.focus?.();
    if (element.isContentEditable) {
      element.textContent = text;
    } else {
      const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      if (setter) setter.call(element, text);
      else element.value = text;
    }

    element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: text }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    element.blur?.();
  }, String(value));
}

function shouldSimulateCloakTyping() {
  return args.browser === "cloak" && args.cloakTyping === "true";
}

async function ensureRepeaterRows(page, label, neededCount, countRows) {
  for (let attempt = 0; attempt < neededCount + 2; attempt += 1) {
    const currentCount = await countRows();
    if (currentCount >= neededCount) return;

    const clicked = await clickAddNewForField(page, label);
    if (!clicked) {
      logStep("warning", `${label}: Add New button not found`);
      return;
    }

    logStep("field", `${label}: Add New`);
    await waitForRowCountIncrease(page, countRows, currentCount);
  }
}

async function clickAddNewForField(page, label) {
  const box = await page.evaluate((labelText) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const target = clean(labelText);
    const label = [...document.querySelectorAll("label, div, span, p")]
      .filter((element) => visible(element) && clean(element.textContent).includes(target))
      .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];

    if (!label) return false;

    const labelRect = label.getBoundingClientRect();
    const buttons = [...document.querySelectorAll("button, [role=button]")]
      .filter((element) => visible(element) && /add new/i.test(clean(element.textContent)))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= labelRect.top - 8)
      .sort((left, right) => {
        const leftDistance = Math.abs(left.rect.top - labelRect.top) + Math.abs(left.rect.left - labelRect.left) * 0.2;
        const rightDistance = Math.abs(right.rect.top - labelRect.top) + Math.abs(right.rect.left - labelRect.left) * 0.2;
        return leftDistance - rightDistance;
      });

    const button = buttons[0]?.element;
    if (!button) return null;
    button.scrollIntoView({ block: "center" });
    const rect = button.getBoundingClientRect();
    return {
      x: rect.left + rect.width / 2,
      y: rect.top + rect.height / 2,
      text: clean(button.textContent),
    };
  }, label);

  if (!box) return false;

  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  return true;
}

async function clickAddNewForFieldDom(page, label, expectedCount) {
  const clicked = await page.evaluate((labelText) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const target = clean(labelText);
    const label = [...document.querySelectorAll("label, div, span, p")]
      .filter((element) => visible(element) && clean(element.textContent).includes(target))
      .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];

    if (!label) return false;

    const labelRect = label.getBoundingClientRect();
    const nextLabelTop =
      [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && /^(long description|arabic long description|gender|gtin)$/i.test(clean(element.textContent)))
        .map((element) => element.getBoundingClientRect().top)
        .filter((top) => top > labelRect.top)
        .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
    const buttons = [...document.querySelectorAll("button, [role=button], div, span")]
      .filter((element) => visible(element) && /^add new$/i.test(clean(element.textContent)))
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.top >= labelRect.top - 8 && rect.top < nextLabelTop)
      .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);
    const button = buttons[0]?.element;
    if (!button) return false;

    button.scrollIntoView({ block: "center", inline: "center" });
    button.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    button.dispatchEvent(new PointerEvent("pointerup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    button.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    if (typeof button.click === "function") button.click();
    return true;
  }, label);

  if (!clicked) return false;
  return waitForFeatureBulletRows(page, expectedCount);
}

async function countFeatureBulletRows(page) {
  return page.evaluate(() => {
    const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const placeholderRows = [...document.querySelectorAll("input:not([type=file]), textarea")]
      .filter(visible)
      .filter((input) => /feature bullet/i.test(input.getAttribute("placeholder") || ""));

    if (placeholderRows.length > 0) return placeholderRows.length;

    const label = [...document.querySelectorAll("label, div, span, p")]
      .filter((element) => visible(element) && clean(element.textContent).includes("feature bullet"))
      .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];

    if (!label) return 0;

    const labelRect = label.getBoundingClientRect();
    const nextLabelTop =
      [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && /^(long description|arabic long description|gender|gtin)$/i.test(clean(element.textContent)))
        .map((element) => element.getBoundingClientRect().top)
        .filter((top) => top > labelRect.top)
        .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;

    return [...document.querySelectorAll("input:not([type=file]), textarea, [contenteditable=true]")]
      .filter(visible)
      .map((input) => input.getBoundingClientRect())
      .filter((rect) => rect.top >= labelRect.top - 12 && rect.top < nextLabelTop).length;
  });
}

async function waitForFeatureBulletRows(page, expectedCount) {
  const deadline = Date.now() + 2500;

  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    if ((await countFeatureBulletRows(page)) >= expectedCount) return true;
  }

  return false;
}

async function fillFeatureBulletAtIndex(page, index, value) {
  const placeholderInputs = page.locator('input[placeholder*="Feature Bullet"], textarea[placeholder*="Feature Bullet"]');

  try {
    if ((await placeholderInputs.count()) > index) {
      await setLocatorValue(page, placeholderInputs.nth(index), value);
      return true;
    }
  } catch {}

  return page.evaluate(
    ({ rowIndex, textValue }) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const setValue = (input) => {
        input.focus();

        if (input.isContentEditable) {
          input.textContent = textValue;
        } else {
          const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
          const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
          if (setter) setter.call(input, textValue);
          else input.value = textValue;
        }

        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: textValue }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
        return true;
      };
      const label = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes("feature bullet"))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length)[0];

      if (!label) return false;

      const labelRect = label.getBoundingClientRect();
      const nextLabelTop =
        [...document.querySelectorAll("label, div, span, p")]
          .filter((element) => visible(element) && /^(long description|arabic long description|gender|gtin)$/i.test(clean(element.textContent)))
          .map((element) => element.getBoundingClientRect().top)
          .filter((top) => top > labelRect.top)
          .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
      const inputs = [...document.querySelectorAll("input:not([type=file]), textarea, [contenteditable=true]")]
        .filter(visible)
        .map((input) => ({ input, rect: input.getBoundingClientRect() }))
        .filter(({ rect }) => rect.top >= labelRect.top - 12 && rect.top < nextLabelTop)
        .sort((left, right) => left.rect.top - right.rect.top || left.rect.left - right.rect.left);

      return inputs[rowIndex]?.input ? setValue(inputs[rowIndex].input) : false;
    },
    { rowIndex: index, textValue: String(value) },
  );
}

async function waitForRowCountIncrease(page, countRows, previousCount) {
  const deadline = Date.now() + 2500;

  while (Date.now() < deadline) {
    await page.waitForTimeout(250);
    if ((await countRows()) > previousCount) return true;
  }

  return false;
}

async function selectOptionalField(page, label, value, options = {}) {
  if (!hasValue(value)) return false;
  const text = normalizeNoonSelectValue(label, value);

  if (!(await clickFieldControl(page, label, { ...options, forceMouse: true }))) {
    logStep("warning", `${label}: control not found, skipped`);
    if (options.blocking !== false) recordFieldIssue(label);
    return false;
  }
  await page.waitForTimeout(300);

  try {
    await waitForAnySelectDropdown(page, 2500);
    await recordVisibleSelectOptions(page, label);
    await page.keyboard.press("Meta+A").catch(() => {});
    await page.keyboard.press("Control+A").catch(() => {});
    await page.keyboard.press("Backspace").catch(() => {});
    await typeSelectSearchText(page, text);
    await waitForSelectOption(page, text, 3500);
    await clickSelectOption(page, text);
    await page.waitForTimeout(500);
    if (!(await isSelectValueSelected(page, label, text, options))) {
      logStep("warning", `${label}: option clicked but selected value was not detected: "${text}"`);
      await recordSelectMismatch(label, text, []);
      if (options.blocking !== false) recordFieldIssue(label);
      return false;
    }
    logStep("field", `${label}: selected "${text}"`);
    return true;
  } catch {
    const optionsText = await readVisibleSelectOptions(page).catch(() => []);
    await page.keyboard.press("Escape").catch(() => {});
    logStep(
      "warning",
      `${label}: option not found for "${text}"${optionsText.length ? `; visible options: ${optionsText.join(" | ")}` : ""}`,
    );
    await recordSelectMismatch(label, text, optionsText);
    if (options.blocking !== false) recordFieldIssue(label);
    return false;
  }
}

async function recordSelectMismatch(label, value, visibleOptions) {
  const entry = {
    time: new Date().toISOString(),
    productDir: args.productDir ?? "",
    label,
    value,
    visibleOptions,
  };

  await appendFile(path.join(rootDir, "outputs", "noon-select-mismatches.jsonl"), `${JSON.stringify(entry)}\n`).catch(() => {});
}

async function recordVisibleSelectOptions(page, label) {
  const visibleOptions = await readVisibleSelectOptions(page).catch(() => []);
  if (visibleOptions.length === 0) return;

  const entry = {
    time: new Date().toISOString(),
    productDir: args.productDir ?? "",
    label,
    visibleOptions,
  };

  await appendFile(path.join(rootDir, "outputs", "noon-select-options.jsonl"), `${JSON.stringify(entry)}\n`).catch(() => {});
}

async function waitForAnySelectDropdown(page, timeout = 3000) {
  await page.waitForFunction(
    () => {
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      return [...document.querySelectorAll(".ant-select-dropdown:not(.ant-select-dropdown-hidden), [role=listbox]")]
        .some(visible);
    },
    null,
    { timeout },
  );
}

async function readVisibleSelectOptions(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    return [
      ...document.querySelectorAll(
        ".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content, [role=option]",
      ),
    ]
      .filter(visible)
      .map((element) => clean(element.textContent))
      .filter(Boolean)
      .filter((text, index, values) => values.indexOf(text) === index)
      .slice(0, 12);
  });
}

function recordFieldIssue(label) {
  fieldIssues.record(label);
}

async function isSelectValueSelected(page, label, value, options = {}) {
  return page.evaluate(
    ({ labelText, expectedValue, occurrence }) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const expected = clean(expectedValue);
      const labels = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && clean(element.textContent).includes(clean(labelText)))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length);
      const label = labels[occurrence] ?? labels[0];
      if (!label) return false;

      const labelRect = label.getBoundingClientRect();
      const elements = [...document.querySelectorAll(".ant-select, [role=combobox], input, textarea, [contenteditable=true]")]
        .filter(visible)
        .map((element) => ({ element, rect: element.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left >= labelRect.left && rect.top >= labelRect.top - 12)
        .sort((left, right) => {
          const leftDistance = Math.abs(left.rect.top - labelRect.top) + Math.max(0, left.rect.left - labelRect.right);
          const rightDistance = Math.abs(right.rect.top - labelRect.top) + Math.max(0, right.rect.left - labelRect.right);
          return leftDistance - rightDistance;
        });
      const selectedText = clean(
        elements
          .slice(0, 3)
          .map(({ element }) => `${element.value || ""} ${element.textContent || ""}`)
          .join(" "),
      );

      return selectedText.includes(expected);
    },
    { labelText: label, expectedValue: value, occurrence: options.occurrence ?? 0 },
  );
}

async function waitForSelectOption(page, value, timeout = 5000) {
  await page.waitForFunction(
    (expectedValue) => {
      const clean = (input) => String(input || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const expected = clean(expectedValue);

      return [...document.querySelectorAll(".ant-select-dropdown .ant-select-item-option-content, [role=option]")]
        .filter(visible)
        .some((element) => clean(element.textContent) === expected || clean(element.textContent).includes(expected));
    },
    value,
    { timeout },
  );
}

async function clickSelectOption(page, value) {
  const exact = new RegExp(`^\\s*${escapeRegExp(value)}\\s*$`, "i");
  const partial = new RegExp(escapeRegExp(value), "i");
  const locators = [
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").filter({ hasText: exact }).first(),
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").filter({ hasText: partial }).first(),
    page.locator("[role=option]").filter({ hasText: exact }).first(),
    page.locator("[role=option]").filter({ hasText: partial }).first(),
  ];

  for (const locator of locators) {
    try {
      await locator.click({ timeout: 1500 });
      return true;
    } catch {}
  }

  await page.keyboard.press("Enter");
  return false;
}

async function fillField(page, label, value, options = {}) {
  const text = String(value);
  const labelCandidates = getFieldLabelCandidates(label);
  const selectors = labelCandidates.flatMap((candidate) => [
    () => page.getByLabel(candidate, { exact: false }),
    () => page.getByPlaceholder(new RegExp(escapeRegExp(candidate), "i")),
  ]);

  for (const locate of selectors) {
    const locator = locate();
    if (await fillLocator(page, locator, text, options)) return true;
  }

  return page.evaluate(
    ({ labelTexts, textValue, occurrence }) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const matchesLabel = (text, targets) => {
        const value = clean(text);
        return targets.some((targetText) => {
          const target = clean(targetText);
          if (value.includes(target)) return true;
          return target.split(" ").filter(Boolean).every((word) => value.includes(word));
        });
      };
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const readValue = (input) => (input.isContentEditable ? input.textContent : input.value);
      const setValue = (input) => {
        input.focus();
        const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;

        if (input.isContentEditable) {
          input.textContent = textValue;
        } else if (setter) {
          setter.call(input, textValue);
        } else {
          input.value = textValue;
        }

        input.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: textValue }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
        return clean(readValue(input)) === clean(textValue);
      };
      const labels = [...document.querySelectorAll("label, div, span, p")]
        .filter((element) => visible(element) && matchesLabel(element.textContent, labelTexts))
        .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length);
      const label = labels[occurrence] ?? labels[0];
      if (!label) return false;

      const labelRect = label.getBoundingClientRect();
      const inputs = [...document.querySelectorAll("input:not([type=file]), textarea, [contenteditable=true]")]
        .filter(visible)
        .map((input) => ({ input, rect: input.getBoundingClientRect() }))
        .filter(({ rect }) => rect.left >= labelRect.left && rect.top >= labelRect.top - 12)
        .sort((left, right) => {
          const leftDistance = Math.abs(left.rect.top - labelRect.top) + Math.max(0, left.rect.left - labelRect.right);
          const rightDistance = Math.abs(right.rect.top - labelRect.top) + Math.max(0, right.rect.left - labelRect.right);
          return leftDistance - rightDistance;
        });

      if (inputs[0]?.input) return setValue(inputs[0].input);

      const scope = label.closest("div, section, form") ?? document;
      const input =
        scope.querySelector("input:not([type=file]), textarea, [contenteditable=true]") ??
        label.parentElement?.querySelector("input:not([type=file]), textarea, [contenteditable=true]");
      if (!input) return false;

      return setValue(input);
    },
    { labelTexts: labelCandidates, textValue: text, occurrence: options.occurrence ?? 0 },
  );
}

function getFieldLabelCandidates(label) {
  const labels = [label];

  if (/^arabic long description$/i.test(label)) {
    labels.push("Long Description Arabic", "Long Description AR", "Arabic Description", "Description Arabic", "Description AR");
  }

  return labels;
}

async function fillLocator(page, locator, value, options) {
  const target = options.occurrence ? locator.nth(options.occurrence) : locator.first();

  try {
    await target.waitFor({ state: "visible", timeout: 1200 });
    await setLocatorValue(page, target, value);
    return target.evaluate(
      (element, expectedValue) => {
        const clean = (input) => String(input || "").replace(/\s+/g, " ").trim();
        const value = element.isContentEditable ? element.textContent : element.value;
        return clean(value) === clean(expectedValue);
      },
      String(value),
    );
  } catch {
    return false;
  }
}

async function selectBrand(page, value) {
  if (isNoBrandValue(value)) {
    if (!(await selectNoBrandCheckbox(page))) throw new Error("No-brand checkbox not found for Brand");
    logStep("field", "Brand: no brand");
    return;
  }

  const candidates = brandCandidates(value);
  const brandInput = page.locator("#selectBrand").first();
  let opened = false;
  let optionsText = [];

  try {
    await brandInput.waitFor({ state: "visible", timeout: 2500 });
    await brandInput.click({ timeout: 2500 });
    opened = true;
  } catch {
    opened = await clickFieldControl(page, "Brand");
    if (opened) await page.waitForTimeout(500);
  }

  if (!opened) throw new Error("Required field not found: Brand");

  for (const brand of candidates) {
    await clearSelectSearch(page);
    await typeSelectSearchText(page, brand);

    try {
      await waitForBrandOption(page, brand);
    } catch {
      optionsText = await readVisibleSelectOptions(page).catch(() => []);
      continue;
    }

    await clickBrandOption(page, brand);

    await page.waitForTimeout(500);
    if (await isBrandSelected(page, brand)) {
      logStep("field", `Brand: ${brand}`);
      return;
    }
  }

  throw new Error(
    `Brand option not found for "${candidates.join('" or "')}"${optionsText.length ? `; visible options: ${optionsText.join(" | ")}` : ""}`,
  );
}

async function clearSelectSearch(page) {
  await page.keyboard.press("Meta+A").catch(() => {});
  await page.keyboard.press("Control+A").catch(() => {});
  await page.keyboard.press("Backspace").catch(() => {});
}

async function selectNoBrandCheckbox(page) {
  const clicked = await page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const checked = (element) => {
      if (!element) return false;
      if (element.matches?.('input[type="checkbox"]')) return element.checked;
      if (element.matches?.('[role="checkbox"]')) return element.getAttribute("aria-checked") === "true";
      const input = element.querySelector?.('input[type="checkbox"]');
      if (input) return input.checked;
      const roleCheckbox = element.querySelector?.('[role="checkbox"]');
      return roleCheckbox?.getAttribute("aria-checked") === "true";
    };
    const labels = [...document.querySelectorAll("label, div, span, p")].filter((element) =>
      clean(element.textContent).includes("this product does not have a brand name"),
    );

    for (const label of labels) {
      const container = label.closest("label, .ant-checkbox-wrapper, div") || label;
      const checkbox = container.querySelector('input[type="checkbox"], [role="checkbox"]') || label.previousElementSibling?.querySelector?.('input[type="checkbox"], [role="checkbox"]');
      if (checked(checkbox || container)) return true;
      const target = checkbox && visible(checkbox) ? checkbox : container;
      if (!target || !visible(target)) continue;
      target.click();
      return true;
    }

    return false;
  });

  if (!clicked) return false;
  await page.waitForTimeout(300);

  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const labels = [...document.querySelectorAll("label, div, span, p")].filter((element) =>
      clean(element.textContent).includes("this product does not have a brand name"),
    );

    for (const label of labels) {
      const container = label.closest("label, .ant-checkbox-wrapper, div") || label;
      const checkbox = container.querySelector('input[type="checkbox"]');
      if (checkbox) return checkbox.checked;
      const roleCheckbox = container.querySelector('[role="checkbox"]');
      if (roleCheckbox) return roleCheckbox.getAttribute("aria-checked") === "true";
    }

    return false;
  });
}

async function waitForBrandOption(page, brand) {
  await page.waitForFunction(
    (expectedBrand) => {
      const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
      const visible = (element) => {
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };
      const expected = clean(expectedBrand);

      return [...document.querySelectorAll(".ant-select-dropdown .ant-select-item-option-content")]
        .filter(visible)
        .some((element) => clean(element.textContent) === expected);
    },
    brand,
    { timeout: 4000 },
  );
}

async function clickBrandOption(page, brand) {
  const exact = new RegExp(`^\\s*${escapeRegExp(brand)}\\s*$`, "i");
  const locators = [
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option-content").filter({ hasText: exact }).first(),
    page.locator(".ant-select-dropdown:not(.ant-select-dropdown-hidden) .ant-select-item-option").filter({ hasText: exact }).first(),
  ];

  for (const locator of locators) {
    try {
      await locator.click({ timeout: 2000 });
      return true;
    } catch {}
  }

  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  return false;
}

async function isBrandSelected(page, brand) {
  return page.evaluate((expectedBrand) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const expected = clean(expectedBrand);
    const visibleText = [...document.querySelectorAll("div,span,p")]
      .filter(visible)
      .map((element) => element.textContent || "")
      .join(" ");
    if (/brand is required/i.test(visibleText)) return false;

    const inputs = [...document.querySelectorAll("input, textarea")];
    if (inputs.some((input) => visible(input) && clean(input.value) === expected)) return true;

    return [...document.querySelectorAll("div, span, p")]
      .some((element) => visible(element) && clean(element.textContent) === expected);
  }, brand);
}

async function clickFieldControl(page, label, options = {}) {
  const byLabel = page.getByLabel(label, { exact: false }).first();

  if (!options.occurrence && !options.forceMouse) {
    try {
      await byLabel.click({ timeout: 1500 });
      return true;
    } catch {}
  }

  const box = await page.evaluate(({ labelText, occurrence }) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const target = clean(labelText);
    const labels = [...document.querySelectorAll("label, div, span, p")]
      .filter((element) => visible(element) && clean(element.textContent).includes(target))
      .sort((left, right) => clean(left.textContent).length - clean(right.textContent).length);
    const label = labels[occurrence] ?? labels[0];
    if (!label) return false;

    const labelRect = label.getBoundingClientRect();
    const controls = [
      ...document.querySelectorAll(
        ".ant-select-selector, .ant-select, input, [role=combobox], [aria-haspopup=listbox], [class*=select], [class*=Select]",
      ),
    ]
      .filter(visible)
      .map((element) => ({ element, rect: element.getBoundingClientRect() }))
      .filter(({ rect }) => rect.left >= labelRect.left && rect.top >= labelRect.top - 12)
      .sort((left, right) => {
        const leftDistance = Math.abs(left.rect.top - labelRect.top) + Math.max(0, left.rect.left - labelRect.right);
        const rightDistance = Math.abs(right.rect.top - labelRect.top) + Math.max(0, right.rect.left - labelRect.right);
        return leftDistance - rightDistance;
      });

    const control = controls[occurrence]?.element ?? controls[0]?.element;
    if (!control) return false;
    control.scrollIntoView({ block: "center", inline: "center" });
    const rect = control.getBoundingClientRect();
    return {
      x: rect.left + Math.max(12, rect.width - 28),
      y: rect.top + rect.height / 2,
    };
  }, { labelText: label, occurrence: options.occurrence ?? 0 });

  if (!box) return false;

  await page.mouse.move(box.x, box.y);
  await page.mouse.down();
  await page.waitForTimeout(80);
  await page.mouse.up();
  return true;
}

async function uploadImages(page, imagePaths) {
  logStep("images", `准备上传 ${imagePaths.length} 张图片`);

  const fileInputs = page.locator("input[type=file]");
  if ((await fileInputs.count()) > 0) {
    await fileInputs.first().setInputFiles(imagePaths);
    logStep("images", "图片已写入 file input");
    await waitForUploadedProductImages(page, imagePaths.length);
    return;
  }

  const chooserPromise = page.waitForEvent("filechooser", { timeout: 10000 });
  await clickButton(page, ["Add Images", "Upload Images", "Upload", "Add Image"], { required: true });
  const chooser = await chooserPromise;
  await chooser.setFiles(imagePaths);
  logStep("images", "图片已通过选择器上传");
  await waitForUploadedProductImages(page, imagePaths.length);
}

async function prepareProductCategory(page, categoryPath) {
  const generated = await clickButton(page, ["Generate Product Category", "Regenerate"], { required: false });
  if (generated) {
    logStep("category", "已请求生成 Product Category。");
    const hasGeneratedOption = await waitForGeneratedCategoryOption(page, 6000);
    if (!hasGeneratedOption) {
      const state = await readProductCategoryState(page).catch(() => ({}));
      logStep("warning", `Product Category 未生成候选: ${JSON.stringify(state)}`);
    }
  }

  const selected = await selectFirstGeneratedCategory(page);
  if (selected) {
    logStep("category", "已选择第一个生成类目。");
    await page.waitForTimeout(1000);
  }

  if (!(await isCategorySelected(page)) && categoryPath.length > 0) {
    const manualSelected = await selectManualCategory(page, categoryPath);
    if (manualSelected) {
      logStep("category", `已手动选择类目: ${categoryPath.join(" > ")}`);
      await page.waitForTimeout(1000);
    }
  }

  logStep("manual_wait", "如果 Product Category 仍为空，请在打开的 noon 窗口选择类目；脚本会等待继续按钮可用。");
  await waitForManualCategoryStep(page);
}

async function waitForUploadedProductImages(page, expectedCount) {
  const expected = Math.max(1, Math.min(Number(expectedCount) || 1, 9));
  const deadline = Date.now() + 4000;

  while (Date.now() < deadline) {
    const count = await countUploadedProductImages(page).catch(() => 0);
    if (count >= expected || count >= 1) {
      logStep("images", `页面已检测到 ${count} 张商品图片。`);
      return true;
    }
    await page.waitForTimeout(1000);
  }

  logStep("warning", "页面未检测到商品图片预览，继续生成 Product Category。");
  return false;
}

async function countUploadedProductImages(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
      .find((element) => clean(element.textContent) === "Product Images");
    if (!heading) return 0;

    const headingTop = heading.getBoundingClientRect().top;
    const nextHeadingTop =
      [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
        .filter((element) => clean(element.textContent) === "Product Category")
        .map((element) => element.getBoundingClientRect().top)
        .filter((top) => top > headingTop)
        .sort((left, right) => left - right)[0] ?? Number.POSITIVE_INFINITY;
    const inBand = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.top >= headingTop - 8 && rect.top < nextHeadingTop;
    };

    const uploadItems = [...document.querySelectorAll(".ant-upload-list-item, [class*=upload-list] [class*=item]")]
      .filter((element) => visible(element) && inBand(element)).length;
    const imagePreviews = [...document.querySelectorAll("img, canvas, [style*=background-image]")]
      .filter((element) => {
        if (!visible(element) || !inBand(element)) return false;
        const rect = element.getBoundingClientRect();
        if (rect.width < 40 || rect.height < 40) return false;
        const text = clean(element.getAttribute?.("alt") || element.getAttribute?.("aria-label") || "");
        return !/info|plus|upload|icon/i.test(text);
      }).length;

    return Math.max(uploadItems, imagePreviews);
  });
}

async function waitForGeneratedCategoryOption(page, timeoutMs = 6000) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (await hasGeneratedCategoryOption(page)) return true;
    await page.waitForTimeout(1000);
  }

  return false;
}

async function hasGeneratedCategoryOption(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
      .find((element) => clean(element.textContent) === "Product Category");
    const section = heading?.closest("section, form, div") ?? document;

    return [...section.querySelectorAll("input[type=radio], [role=radio], [role=option], li, [data-testid*=category]")]
      .some((element) => visible(element) && !/generate product category/i.test(clean(element.textContent)));
  });
}

async function readProductCategoryState(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const text = document.body?.innerText ?? "";
    const buttons = [...document.querySelectorAll("button, [role=button]")]
      .filter(visible)
      .map((element) => clean(element.textContent))
      .filter((value) => /category|generate|manual|select|regenerate/i.test(value));

    return {
      categoryRequired: /Category is required/i.test(text),
      visibleCategoryButtons: [...new Set(buttons)].slice(0, 8),
    };
  });
}

async function isCategorySelected(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText ?? "";
    if (/Category is required/i.test(text)) return false;

    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const heading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
      .find((element) => clean(element.textContent) === "Product Category");
    const section = heading?.closest("section, form, div") ?? document;

    return [...section.querySelectorAll("input[type=radio], [role=radio]")]
      .some((element) => element.checked || element.getAttribute("aria-checked") === "true");
  });
}

async function selectManualCategory(page, categoryPath) {
  await clickButton(page, ["Select Manually"], { required: false });
  await page.waitForTimeout(1000);

  for (const rawName of categoryPath) {
    const clicked = await clickCategoryRow(page, rawName);
    if (!clicked) return false;
    await page.waitForTimeout(800);
  }

  return true;
}

async function clickCategoryRow(page, rawName) {
  const names = categoryNameCandidates(rawName);

  for (const name of names) {
    const locator = page
      .locator("div, li, button, span")
      .filter({ hasText: new RegExp(`^\\s*${escapeRegExp(name)}\\s*$`, "i") })
      .first();

    try {
      await locator.click({ timeout: 2500 });
      return true;
    } catch {}
  }

  return page.evaluate((candidateNames) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };
    const candidates = candidateNames.map(clean);
    const element = [...document.querySelectorAll("div, li, button, span")]
      .filter(visible)
      .find((item) => candidates.includes(clean(item.textContent)));

    element?.click();
    return Boolean(element);
  }, names);
}

function categoryNameCandidates(name) {
  const value = String(name || "").trim();
  const candidates = [value];

  if (/^bags\s+luggage$/i.test(value)) candidates.push("Bags & Luggage");
  if (/^bags\s*&\s*luggage$/i.test(value)) candidates.push("Bags Luggage");
  if (/^handbag$/i.test(value)) candidates.push("Handbags", "Hand Bags", "Bags");
  if (/^clutch$/i.test(value)) candidates.push("Clutches", "Clutch Bags", "Evening Bags");

  return [...new Set(candidates.filter(Boolean))];
}

async function selectFirstGeneratedCategory(page) {
  return page.evaluate(() => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim();
    const productCategoryHeading = [...document.querySelectorAll("h1,h2,h3,h4,div,span,p")]
      .find((element) => clean(element.textContent) === "Product Category");
    const section = productCategoryHeading?.closest("section, form, div") ?? document;
    const option =
      section.querySelector("input[type=radio]:not(:checked)") ??
      section.querySelector("[role=radio][aria-checked=false]") ??
      section.querySelector("[role=option]") ??
      section.querySelector("li, [data-testid*=category]");

    if (!option) return false;
    option.click();
    return true;
  });
}

async function waitForStep(page, expectedStep, previousStep) {
  const deadline = Date.now() + 30000;

  while (Date.now() < deadline) {
    const state = await readStepState(page, expectedStep);
    if (state.hasExpectedInProgress || state.hasExpectedContent) return;
    await page.waitForTimeout(1000);
  }

  const errors = await readVisibleErrors(page);
  throw new Error(
    `${previousStep} did not advance to ${expectedStep}.${errors.length ? ` Visible errors: ${errors.join(" / ")}` : ""}`,
  );
}

async function readStepState(page, expectedStep) {
  return page.evaluate((step) => {
    const text = document.body?.innerText?.replace(/\s+/g, " ") ?? "";
    const escaped = step.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const hasAll = (patterns) => patterns.every((pattern) => pattern.test(text));
    const hasStepFormSignals = (() => {
      if (/^Product Content$/i.test(step)) {
        return hasAll([/Feature Bullet/i, /Long Description/i, /Gender/i]);
      }
      if (/^Offer Details$/i.test(step)) {
        return hasAll([/Partner SKU/i, /Price/i, /Warehouse/i, /Stock/i]);
      }
      return false;
    })();

    return {
      hasExpectedInProgress: new RegExp(`${escaped}\\s+In progress`, "i").test(text),
      hasExpectedContent: new RegExp(`^\\s*${escaped}\\s*$`, "im").test(text) || hasStepFormSignals,
    };
  }, expectedStep);
}

async function readVisibleErrors(page) {
  return page.evaluate(() => {
    const visible = (element) => {
      const rect = element.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    return [...document.querySelectorAll("div,span,p")]
      .filter(visible)
      .map((element) => String(element.textContent || "").replace(/\s+/g, " ").trim())
      .filter((text) => /required|invalid|select|category|feature|bullet|description|arabic|must|minimum|maximum|enter|fill|value|error/i.test(text))
      .filter((text, index, values) => text && text.length < 180 && values.indexOf(text) === index)
      .slice(0, 8);
  });
}

async function waitForUploadPage(page, onLoginPage) {
  const deadline = Date.now() + manualWaitMs;
  let sawLoginPage = false;
  let returnedToUploadUrl = false;
  let loggedWaiting = false;

  while (Date.now() < deadline) {
    const signals = await readNoonPageSignals(page);

    if (signals.uploadPageReachable) {
      if (sawLoginPage) logStep("login", "已进入 Add Product 页面，继续上传。");
      return sawLoginPage;
    }

    if (signals.hasLoginCopy) {
      sawLoginPage = true;
      onLoginPage();
      if (!loggedWaiting) {
        logStep("login", "检测到 noon 登录页。请在打开的浏览器中完成登录，脚本会等待并继续。");
        loggedWaiting = true;
      }
    } else if (sawLoginPage && !returnedToUploadUrl) {
      returnedToUploadUrl = true;
      logStep("login", "登录页已离开，重新打开 Add Product 链接。");
      await gotoNoonCreatePage(page).catch((error) => {
        logStep("network", `重新打开 Add Product 失败: ${error.message}`);
      });
    }

    await page.waitForTimeout(1500);
  }

  if (sawLoginPage) {
    throw new Error(`Waiting for noon login timed out after ${Math.round(manualWaitMs / 1000)}s. Browser left open.`);
  }

  throw new Error(`Add Product page not ready: ${await page.title()} ${page.url()}`);
}

async function readNoonPageSignals(page) {
  return page.evaluate(() => {
    const text = document.body?.innerText?.replace(/\s+/g, " ").slice(0, 3000) ?? "";
    const hasAddProduct = /Add Product/i.test(text);
    const hasProductIdentity = /Product Identity/i.test(text);
    const hasEnglishTitle = /English Title/i.test(text);
    const hasPartnerSku = /Partner SKU/i.test(text);

    return {
      uploadPageReachable: hasAddProduct && hasProductIdentity && hasEnglishTitle && hasPartnerSku,
      hasLoginCopy: /Welcome Back|Log in to continue|Register Now|Sign in|Login/i.test(text),
    };
  });
}

async function waitForManualCategoryStep(page) {
  if (input.isTTY) {
    const rl = createInterface({ input, output });
    await rl.question("Brand 和 Product Category 选好后按 Enter 继续...");
    rl.close();
    return;
  }

  const deadline = Date.now() + manualWaitMs;
  while (Date.now() < deadline) {
    if (await isButtonEnabled(page, ["Create & Continue", "Continue"])) return;
    await page.waitForTimeout(1500);
  }

  throw new Error(`Manual Brand/Product Category step timed out after ${Math.round(manualWaitMs / 1000)}s.`);
}

async function clickButton(page, names, options = {}) {
  for (const name of names) {
    const byRole = page.getByRole("button", { name: new RegExp(escapeRegExp(name), "i") }).first();
    try {
      await byRole.waitFor({ state: "visible", timeout: 1500 });
      await byRole.click({ timeout: 5000 });
      logStep("button", name);
      await page.waitForTimeout(1500);
      return true;
    } catch {}
  }

  const clicked = await page.evaluate((buttonNames) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const targets = buttonNames.map(clean);
    const button = [...document.querySelectorAll("button, [role=button]")]
      .find((element) => targets.some((target) => clean(element.textContent).includes(target)) && !element.disabled);
    button?.click();
    return Boolean(button);
  }, names);

  if (clicked) {
    logStep("button", names[0]);
    await page.waitForTimeout(1500);
    return true;
  }

  if (options.required) throw new Error(`Button not found: ${names.join(" / ")}`);
  return false;
}

async function isButtonEnabled(page, names) {
  return page.evaluate((buttonNames) => {
    const clean = (value) => String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
    const targets = buttonNames.map(clean);
    const button = [...document.querySelectorAll("button, [role=button]")]
      .find((element) => targets.some((target) => clean(element.textContent).includes(target)));
    if (!button) return false;
    return !button.disabled && button.getAttribute("aria-disabled") !== "true";
  }, names);
}

async function waitForReady(page) {
  await page.waitForLoadState("domcontentloaded", { timeout: 90000 }).catch(() => {});
  await page.waitForTimeout(2000);
}

async function gotoNoonCreatePage(page) {
  const maxAttempts = 3;
  let lastError = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      logStep("network", `打开 noon Add Product 页面: ${attempt}/${maxAttempts}`);
      await page.goto(args.noonUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
      logStep("network", `当前URL: ${page.url()}`);
      return;
    } catch (error) {
      lastError = error;
      logStep("network", `打开失败 ${attempt}/${maxAttempts}: ${error.message}`);

      if (attempt < maxAttempts) {
        const waitMs = 5000 * attempt;
        logStep("network", `等待 ${Math.round(waitMs / 1000)}s 后重试`);
        await page.waitForTimeout(waitMs);
      }
    }
  }

  throw lastError;
}

async function createBrowser() {
  if (args.browser === "cloak") {
    try {
      return await createCloakBrowser();
    } catch (error) {
      logStep("browser", `CloakBrowser 启动失败，回退系统 Chrome: ${error.message}`);
      return createChromeBrowser();
    }
  }

  if (args.browser !== "cloak") {
    try {
      return await createChromeBrowser();
    } catch (error) {
      logStep("browser", `系统 Chrome 启动失败，回退 CloakBrowser: ${error.message}`);
    }
  }

  return createCloakBrowser();
}

async function createChromeBrowser() {
  const { chromium } = await import("playwright-core");
  const executablePath = chromeExecutablePath();

  if (!executablePath) throw new Error("未找到 Google Chrome。");

  logStep("browser", `使用系统 Chrome: ${executablePath}`);
  const context = await chromium.launchPersistentContext(path.resolve(rootDir, args.profile ?? ".noon-profile"), {
    executablePath,
    headless: args.headless === "true",
    locale: "en-US",
    timezoneId: "Asia/Dubai",
    viewport: { width: 1440, height: 960 },
    args: ["--disable-blink-features=AutomationControlled"],
  });

  return {
    newPage() {
      return context.newPage();
    },
    close() {
      return context.close();
    },
  };
}

function chromeExecutablePath() {
  const candidates = [
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  ];

  return candidates.find((candidate) => {
    try {
      accessSync(candidate);
      return true;
    } catch {
      return false;
    }
  });
}

async function createCloakBrowser() {
  const { launchPersistentContext } = await importCloakBrowser();
  logStep("browser", "使用 CloakBrowser");
  const context = await launchPersistentContext({
    userDataDir: path.resolve(rootDir, args.profile ?? ".noon-profile"),
    headless: args.headless === "true",
    locale: "en-US",
    timezone: "Asia/Dubai",
    viewport: { width: 1440, height: 960 },
    humanize: true,
    humanPreset: "careful",
  });

  return {
    newPage() {
      return context.newPage();
    },
    close() {
      return context.close();
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

function parseArgs(argv) {
  const parsed = {};

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) continue;

    const key = arg.slice(2);
    const next = argv[index + 1];
    if (!next || next.startsWith("--")) {
      parsed[key] = "true";
    } else {
      parsed[key] = next;
      index += 1;
    }
  }

  return {
    ...parsed,
    productDir: parsed["product-dir"] ?? parsed.productDir,
    productDirs: parsed["product-dirs"] ?? parsed.productDirs,
    noonUrl: parsed["noon-url"] ?? parsed.noonUrl,
    storeId: parsed["store-id"] ?? parsed.storeId,
    manualWaitMs: parsed["manual-wait-ms"] ?? parsed.manualWaitMs,
    keepOpen: parsed["keep-open"] ?? parsed.keepOpen,
    stopAfterDetailedContent: parsed["stop-after-detailed-content"] ?? parsed.stopAfterDetailedContent,
    stopAfterOfferDetails: parsed["stop-after-offer-details"] ?? parsed.stopAfterOfferDetails,
    cloakTyping: parsed["cloak-typing"] ?? parsed.cloakTyping,
    validateOnly: parsed["validate-only"] ?? parsed.validateOnly,
    browser: parsed.browser ?? "cloak",
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function escapeRegExp(value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function logStep(scope, message) {
  console.log(`[${scope}] ${message}`);
}

function fail(message) {
  console.error(`[failed] ${message}`);
  process.exit(1);
}
