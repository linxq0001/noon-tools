#!/usr/bin/env node

import { importCloakBrowser } from "./lib/cloak-browser.js";

import { parseCliArgs } from "./lib/cli-args.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseCliArgs(process.argv.slice(2));
const noonUrl = args.noonUrl ?? args["noon-url"] ?? "https://noon-catalog.noon.partners/en/catalog/create?project=PRJ517205";

const { launchPersistentContext } = await importCloakBrowser();
const context = await launchPersistentContext({
  userDataDir: path.resolve(rootDir, args.profile ?? ".noon-profile"),
  headless: false,
  locale: "en-US",
  timezone: "Asia/Dubai",
  viewport: { width: 1440, height: 960 },
  humanize: true,
  humanPreset: "careful",
});

const page = context.pages()[0] ?? (await context.newPage());
await page.goto(noonUrl, { waitUntil: "domcontentloaded", timeout: 90000 });

console.log("Noon login browser is open.");
console.log(`Profile: ${path.resolve(rootDir, args.profile ?? ".noon-profile")}`);
console.log(`URL: ${page.url()}`);
console.log("Log in manually, then press Ctrl+C here after the upload page opens.");

process.on("SIGINT", async () => {
  await context.close();
  process.exit(0);
});

await new Promise(() => {});

