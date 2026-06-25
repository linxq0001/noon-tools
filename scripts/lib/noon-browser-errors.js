export function normalizeNoonBrowserError(error, profile = "") {
  const message = error instanceof Error ? error.message : String(error || "检测失败");
  if (/ProcessSingleton|existing browser session|profile.*in use|launchPersistentContext/i.test(message)) {
    const profileSuffix = profile ? `Profile: ${profile}` : "";
    return `Noon 浏览器资料正在被另一个窗口或任务使用。请先关闭该店铺的 noon 登录/检测/上传窗口，再重新检测。${profileSuffix}`.trim();
  }

  return message;
}
