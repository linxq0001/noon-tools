export function detect1688AccessState({ url = "", title = "", text = "", html = "" } = {}) {
  const haystack = [url, title, text, html].map((value) => String(value || "")).join("\n");

  if (/^chrome-error:\/\//i.test(url)) {
    return {
      blocked: true,
      reason: "navigation_error",
      message: "Chromium 未能打开该 1688 页面。",
    };
  }

  if (
    /login\.(taobao|1688)\.com/i.test(url) ||
    /密码登录|短信登录|扫码登录|免费注册/.test(haystack) ||
    /"action"\s*:\s*"login"|login_jump|_____tmd_____/.test(haystack)
  ) {
    return {
      blocked: true,
      reason: "login_required",
      message: "该 1688 页面触发了淘宝/1688 登录校验。",
    };
  }

  if (/滑块|拖动.*验证|按住.*滑块|安全验证|验证码|nc_1_n1z|btn_slide|nocaptcha|noCaptcha/i.test(haystack)) {
    return {
      blocked: true,
      reason: "slider_challenge",
      message: "该 1688 页面触发了风控滑块验证。",
    };
  }

  if (/x5secdata|rgv587_flag|bxpunish|punish/i.test(haystack)) {
    return {
      blocked: true,
      reason: "access_challenge",
      message: "该 1688 页面触发了风控验证，未返回可解析的商品列表。",
    };
  }

  return {
    blocked: false,
    reason: "",
    message: "",
  };
}
