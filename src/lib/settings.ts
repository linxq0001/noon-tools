import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { UI_SETTING_KEYS, type UiSettings } from "./settings-fields.ts";
export { UI_SETTING_KEYS, type UiSettings } from "./settings-fields.ts";

export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function settingsPath(rootDir = projectRoot()) {
  return path.join(rootDir, ".ui-settings.json");
}

export function sanitizeUiSettings(values: unknown): UiSettings {
  const source = values && typeof values === "object" ? values as Record<string, unknown> : {};
  const settings: UiSettings = {};
  const aliases: Record<string, string> = {
    deepseekApiKey: "deepSeekApiKey",
    deepseekModel: "deepSeekModel",
    uploadHeadless: "noonHeadless",
  };

  for (const key of UI_SETTING_KEYS) {
    if (source[key] !== undefined) settings[key] = String(source[key]);
  }

  for (const [from, to] of Object.entries(aliases)) {
    if (settings[to as keyof UiSettings] === undefined && source[from] !== undefined) {
      settings[to as keyof UiSettings] = String(source[from]);
    }
  }

  return settings;
}

export async function readUiSettings(rootDir = projectRoot()): Promise<UiSettings> {
  try {
    return sanitizeUiSettings(JSON.parse(await readFile(settingsPath(rootDir), "utf8")));
  } catch {
    return {};
  }
}

export async function saveUiSettings(values: unknown, rootDir = projectRoot()): Promise<UiSettings> {
  const next: UiSettings = {
    ...await readUiSettings(rootDir),
    ...sanitizeUiSettings(values),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(settingsPath(rootDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
