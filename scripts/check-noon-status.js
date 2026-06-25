#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { normalizeNoonBrowserError } from "./lib/noon-browser-errors.js";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const noonUrl = args.noonUrl ?? args["noon-url"] ?? "https://noon-catalog.noon.partners/en/catalog/create?project=PRJ517205";
const profile = args.profile ?? ".noon-profile";

try {
  const status = await checkNoonStatus({ noonUrl, profile });
  console.log(JSON.stringify(status));
} catch (error) {
  console.log(
    JSON.stringify({
      status: "error",
      loggedIn: false,
      uploadPageReachable: false,
      error: normalizeNoonBrowserError(error, profile),
      checkedAt: new Date().toISOString(),
    }),
  );
  process.exitCode = 1;
}

async function checkNoonStatus({ noonUrl, profile }) {
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
    await page.goto(noonUrl, { waitUntil: "domcontentloaded", timeout: 90000 });
    await page.waitForTimeout(8000);

    const currentUrl = page.url();
    const redirectedToLogin = /login\.noon\.partners/i.test(currentUrl);

    const result = await page.evaluate(() => {
      const bodyText = document.body?.innerText ?? "";
      const text = bodyText.replace(/\s+/g, " ").slice(0, 3000);
      return {
        text,
        hasAddProduct: /Add Product/i.test(text),
        hasProductIdentity: /Product Identity/i.test(text),
        hasEnglishTitle: /English Title/i.test(text),
        hasPartnerSku: /Partner SKU/i.test(text),
        hasCreateContinue: /Create\s*&\s*Continue/i.test(text),
        hasLoginCopy: /Welcome Back|Log in to continue|Register Now/i.test(text),
      };
    });

    const uploadPageReachable =
      !redirectedToLogin &&
      result.hasAddProduct &&
      result.hasProductIdentity &&
      result.hasEnglishTitle &&
      result.hasPartnerSku;

    const isLoginPage =
      redirectedToLogin || result.hasLoginCopy;

    return {
      status: uploadPageReachable ? "logged_in" : isLoginPage ? "logged_out" : "unknown",
      loggedIn: uploadPageReachable,
      uploadPageReachable,
      redirectedToLogin,
      finalUrl: currentUrl,
      title: await page.title(),
      checkedAt: new Date().toISOString(),
      signals: result,
    };
  } finally {
    await context.close();
  }
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

  return parsed;
}
