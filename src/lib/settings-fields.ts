export const UI_SETTING_KEYS = [
  "url",
  "limit",
  "delaySeconds",
  "headless",
  "proxy",
  "repository",
  "noonBrowser",
  "noonCloakTyping",
  "noonHeadless",
  "catalogType",
  "deepSeekModel",
  "deepSeekApiKey",
  "defaultStoreId",
  "globalExchangeRate",
  "globalPlatformFeeRate",
  "globalTargetMargin",
] as const;

export type UiSettingKey = (typeof UI_SETTING_KEYS)[number];
export type UiSettings = Partial<Record<UiSettingKey | "updatedAt", string>>;
