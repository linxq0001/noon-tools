export function detect1688AccessState({ url = "", title = "", text = "", html = "" } = {}) {
  const haystack = [url, title, text, html].map((value) => String(value || "")).join("\n");

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
