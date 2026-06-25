#!/usr/bin/env node

import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const args = parseArgs(process.argv.slice(2));
const loginUrl = args.url || "https://www.1688.com/";
const profile = args.profile || ".cloakbrowser-profile";
const minOpenSeconds = Number.parseInt(args["min-open-seconds"] || "10", 10);
const waitSeconds = Number.parseInt(args["wait-seconds"] || "300", 10);

try {
  await main();
} catch (error) {
  if (/Target page, context or browser has been closed|has been closed/i.test(error.message)) {
    console.error("[login] 登录窗口已关闭。如果还未完成登录，请重新点击登录1688。");
  } else {
    console.error(`[login] ${error.message}`);
  }
  process.exitCode = 1;
}

async function main() {
  const { launchPersistentContext } = await importCloakBrowser();
  const context = await launchPersistentContext({
    userDataDir: path.resolve(rootDir, profile),
    headless: false,
    locale: "zh-CN",
    timezone: "Asia/Shanghai",
    viewport: { width: 1365, height: 900 },
    humanize: true,
    humanPreset: "careful",
  });

  try {
    const page = context.pages()[0] ?? (await context.newPage());

    console.log(`[login] 使用 Profile: ${profile}`);
    console.log(`[login] 打开: ${loginUrl}`);
    await page.goto(loginUrl, { waitUntil: "domcontentloaded", timeout: 60000 });
    await page.waitForTimeout(1500);

    let state = await readLoginState(page);
    console.log(`[login] 当前URL: ${state.url}`);
    console.log(`[login] 页面标题: ${state.title || "(空)"}`);

    console.log("[login] 请在 CloakBrowser 窗口中完成 1688/淘宝登录。");
    console.log("[login] 检测到登录态后会自动关闭窗口并释放 Profile，后续采集会复用该 Profile。");

    for (let elapsed = 0; elapsed < waitSeconds && !page.isClosed(); elapsed += 1) {
      await page.waitForTimeout(1000);
      state = await readLoginState(page).catch(() => null);
      if (elapsed + 1 >= minOpenSeconds && state?.looksLoggedIn) {
        console.log(`[login] 已检测到登录态: ${state.url}`);
        console.log("[login] 已保存登录信息，后续采集不用每次扫码。");
        process.exitCode = 0;
        return;
      }

      if (elapsed % 10 === 9) {
        console.log(`[login] 等待登录中: ${elapsed + 1}s`);
      } else {
      }
    }

    console.log("[login] 登录窗口已关闭或等待超时。");
    process.exitCode = page.isClosed() ? 0 : 1;
  } finally {
    await context.close();
  }
}

async function readLoginState(page) {
  const state = await page.evaluate(() => {
    const url = location.href;
    const title = document.title || "";
    const text = document.body?.innerText || "";
    const isLoginPage =
      /login\.(taobao|1688)\.com/i.test(url) ||
      /密码登录|短信登录|扫码登录|免费注册/.test(text) ||
      /登录/.test(title);
    const looksLoggedIn =
      /1688\.com/i.test(url) &&
      !isLoginPage &&
      /我的阿里|我的1688|退出|账号管理|买家中心|卖家中心/.test(text) &&
      !/请登录|免费注册|密码登录|短信登录|扫码登录/.test(text);

    return { url, title, isLoginPage, looksLoggedIn };
  });
  const cookies = await page.context().cookies(["https://www.1688.com", "https://login.taobao.com", "https://login.1688.com"]);
  const cookieNames = new Set(cookies.map((cookie) => cookie.name));
  state.looksLoggedIn =
    state.looksLoggedIn ||
    cookieNames.has("__cn_logon__") ||
    cookieNames.has("cookie2") ||
    cookieNames.has("unb") ||
    cookieNames.has("sgcookie");

  return state;
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

function parseArgs(values) {
  const parsed = {};

  for (let index = 0; index < values.length; index += 1) {
    const value = values[index];

    if (value.startsWith("--")) {
      const key = value.slice(2);
      parsed[key] = values[index + 1] && !values[index + 1].startsWith("--") ? values[++index] : "true";
    }
  }

  return parsed;
}
