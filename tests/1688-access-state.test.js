import assert from "node:assert/strict";
import test from "node:test";
import { detect1688AccessState } from "../scripts/lib/1688-access-state.js";

test("detect1688AccessState recognises Taobao login pages", () => {
  const state = detect1688AccessState({
    url: "https://login.taobao.com/havanaone/login/login.htm",
    title: "登录",
    text: "密码登录 短信登录 免费注册",
  });

  assert.equal(state.blocked, true);
  assert.equal(state.reason, "login_required");
});

test("detect1688AccessState recognises x5sec login jump challenge pages", () => {
  const state = detect1688AccessState({
    url: "https://shop.example.1688.com/page/offerlist.htm",
    title: "全部商品页",
    html: '<script>document.cookie="x5secdata=..."; var jump=".../_____tmd_____/page/login_jump";</script><!--rgv587_flag:sm-->',
  });

  assert.equal(state.blocked, true);
  assert.equal(state.reason, "login_required");
});
