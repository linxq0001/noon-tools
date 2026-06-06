#!/usr/bin/env node

import path from "node:path";
import { publishProductImages } from "./lib/publishable-images.js";

const args = process.argv.slice(2);
const productsDir = args[0] ? path.resolve(args[0]) : "";
const outputPath = args[1] ? path.resolve(args[1]) : "";
const credentialsPath = optionValue("--credentials") || process.env.GOOGLE_APPLICATION_CREDENTIALS || "";
const folderId = optionValue("--drive-folder") || process.env.GOOGLE_DRIVE_FOLDER_ID || "";
const folderName = optionValue("--drive-folder-name") || process.env.GOOGLE_DRIVE_FOLDER_NAME || "";
const dryRun = args.includes("--dry-run");

if (!productsDir || !outputPath) {
  console.error(
    "Usage: npm run publish:images -- <products-dir> <manifest.json> --credentials <service-account.json> --drive-folder <folder-id>",
  );
  process.exit(1);
}

try {
  const manifest = await publishProductImages({
    productsDir,
    outputPath,
    credentialsPath: credentialsPath ? path.resolve(credentialsPath) : "",
    folderId,
    folderName,
    dryRun,
  });
  const imageCount = Object.values(manifest.products).reduce((sum, product) => sum + product.images.length, 0);
  console.log(`Published ${imageCount} image(s) for ${Object.keys(manifest.products).length} product(s) to ${outputPath}`);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}

function optionValue(name) {
  const index = args.indexOf(name);
  return index === -1 ? "" : args[index + 1] || "";
}
