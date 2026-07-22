#!/usr/bin/env node

import path from "node:path";
import { exportNoonBulkUpdates } from "./lib/noon-bulk-update-exporter.js";

const args = process.argv.slice(2);
const productsDir = path.resolve(positional(0) || "products");
const outputDir = path.resolve(positional(1) || "exports/noon-bulk-updates");
const platform = optionValue("--platform");
const repository = optionValue("--repository");
const catalogType = optionValue("--catalog-type") || "global";
const productDirs = optionValue("--product-dirs")
  .split(",")
  .map((value) => value.trim())
  .filter(Boolean);

const result = await exportNoonBulkUpdates({ productsDir, outputDir, platform, repository, catalogType, productDirs });

console.log(`Exported ${result.skuCount} SKU row(s) from ${result.productCount} product(s) to ${outputDir}`);
if (result.duplicateProducts.length) {
  console.log(`Skipped ${result.duplicateProducts.length} duplicate product(s).`);
}
for (const filePath of Object.values(result.files)) console.log(filePath);

function positional(index) {
  return args.filter((value, valueIndex) => !value.startsWith("--") && !optionNames().has(args[valueIndex - 1]))[index];
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function optionNames() {
  return new Set(["--platform", "--repository", "--catalog-type", "--product-dirs"]);
}
