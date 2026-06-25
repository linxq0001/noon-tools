#!/usr/bin/env node

import { importCloakBrowser } from "./lib/cloak-browser.js";

import { parseCliArgs } from "./lib/cli-args.js";

import path from "node:path";
import { fileURLToPath } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseCliArgs(process.argv.slice(2));
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
    headless: false,
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


function normalizeNoonBrowserError(error, profile = "") {
  const message = error instanceof Error ? error.message : String(error || "检测失败");
  if (/ProcessSingleton|existing browser session|profile.*in use|launchPersistentContext/i.test(message)) {
    const profileSuffix = profile ? `Profile: ${profile}` : "";
    return `Noon 浏览器资料正在被另一个窗口或任务使用。请先关闭该店铺的 noon 登录/检测/上传窗口，再重新检测。${profileSuffix}`.trim();
  }
  return message;
}
