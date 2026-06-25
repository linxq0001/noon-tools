import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoonBrowserError } from "../scripts/lib/noon-browser-errors.js";

test("normalizes persistent profile lock errors", () => {
  const error = new Error(
    "browserType.launchPersistentContext: Failed to create a ProcessSingleton for your profile directory.",
  );

  assert.equal(
    normalizeNoonBrowserError(error, ".noon-profiles/UAE01"),
    "Noon 浏览器资料正在被另一个窗口或任务使用。请先关闭该店铺的 noon 登录/检测/上传窗口，再重新检测。Profile: .noon-profiles/UAE01",
  );
});

test("keeps unrelated browser errors readable", () => {
  assert.equal(normalizeNoonBrowserError(new Error("Navigation timeout"), ".noon-profiles/UAE01"), "Navigation timeout");
});
