#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
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

  return parsed;
}
