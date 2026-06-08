#!/usr/bin/env node

import path from "node:path";
import { exportNoonBulkUpdates } from "./lib/noon-bulk-update-exporter.js";

const args = process.argv.slice(2);
const productsDir = path.resolve(positional(0) || "products");
const outputDir = path.resolve(positional(1) || "exports/noon-bulk-updates");
const repository = optionValue("--repository");

const result = await exportNoonBulkUpdates({ productsDir, outputDir, repository });

console.log(`Exported ${result.skuCount} SKU row(s) from ${result.productCount} product(s) to ${outputDir}`);
for (const filePath of Object.values(result.files)) console.log(filePath);

function positional(index) {
  return args.filter((value, valueIndex) => !value.startsWith("--") && !optionNames().has(args[valueIndex - 1]))[index];
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}

function optionNames() {
  return new Set(["--repository"]);
}
