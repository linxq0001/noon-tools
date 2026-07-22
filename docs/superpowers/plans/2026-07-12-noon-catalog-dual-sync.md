# Noon 商品目录双同步 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Noon 工作台提供可明确选择的内部 API 快速同步和报表导出同步，并让两种方案生成兼容的商品目录快照。

**Architecture:** 保留现有导出同步实现，新增一个只负责登录态内部接口分页读取的脚本与库。Route Handler 继续调用 `startNoonCatalogSyncJob`，由服务层校验 `source` 并路由脚本；客户端用两个按钮传递明确来源，现有任务轮询和快照读取保持不变。

**Tech Stack:** Next.js 15、TypeScript、React 19、Node.js test runner、CloakBrowser、现有 JSON 快照存储。

## Global Constraints

- `source` 必须是 `internal_api` 或 `export`，缺失和未知值均拒绝。
- 内部 API 固定每页 100 条、最多 8 个并发，不新增配置和依赖。
- 动态读取 `noon_store_code`，不得写死店铺代码。
- 内部 API 失败不得自动切换导出。
- 不输出 Cookie、Authorization、APIJWT 或浏览器存储。
- Next 服务仅绑定 `127.0.0.1`；同步任务创建、轮询和快照读取统一校验 loopback Host，写请求额外校验同源 Origin。
- 不修改数据库、批量操作、上传逻辑，不自动 commit、push 或部署。

---

### Task 1: 内部 API 分页同步库

**Files:**
- Create: `scripts/lib/noon-catalog-internal-sync.js`
- Test: `tests/noon-catalog-internal-sync.test.js`

**Interfaces:**
- Produces: `syncNoonCatalogFromInternalApi(options)`，返回 `{ status, mode, storeId, catalogUrl, finalUrl, rowCount, output, syncedAt }`。
- Produces: `catalogRowsFromInternalHits(hits)`，把 Noon `data.hits` 转成现有快照 `{ cells, imageUrl }[]`。
- Consumes: 注入的 `openSession` 测试适配器，提供 `getStoreCode()`、`listOffers(body)` 和 `close()`，生产脚本负责用浏览器实现该适配器。

- [ ] **Step 1: 写分页、并发和字段映射失败测试**

```js
test("syncNoonCatalogFromInternalApi reads every page in batches of eight", async () => {
  const requestedPages = [];
  const result = await syncNoonCatalogFromInternalApi({
    rootDir,
    storeId: "PRJ517205",
    mode: "global",
    pageSize: 100,
    concurrency: 8,
    openSession: async () => ({
      finalUrl: "https://noon-catalog.noon.partners/en/catalog?project=PRJ517205",
      getStoreCode: async () => "STR517205-NSA",
      listOffers: async ({ page, per_page }) => {
        requestedPages.push({ page, per_page });
        return { data: { total: 201, hits: [{ partner_sku: `P-${page}`, zsku_child: `Z-${page}`, content: { title: `Item ${page}` } }] } };
      },
      close: async () => {},
    }),
  });
  assert.deepEqual(requestedPages.map((item) => item.page).sort((a, b) => a - b), [1, 2, 3]);
  assert.ok(requestedPages.every((item) => item.per_page === 100));
  assert.equal(result.rowCount, 3);
});
```

增加独立测试断言：空 `noon_store_code`、非 2xx 等价错误、缺少 `data.total`/`data.hits` 时拒绝；`partner_sku`、`zsku_child`、标题、价格、库存、状态和图片转换为现有 `cells`。

- [ ] **Step 2: 运行测试并确认因模块不存在而失败**

Run: `node --test tests/noon-catalog-internal-sync.test.js`

Expected: FAIL，错误包含 `ERR_MODULE_NOT_FOUND` 或缺少导出函数。

- [ ] **Step 3: 实现最小分页同步库**

```js
export async function syncNoonCatalogFromInternalApi({
  rootDir,
  storeId,
  mode,
  catalogUrl,
  openSession,
  pageSize = 100,
  concurrency = 8,
  now = () => new Date(),
}) {
  const session = await openSession({ catalogUrl, storeId });
  try {
    const noonStoreCode = await session.getStoreCode();
    if (!noonStoreCode) throw new Error("找不到 Noon Store Code。");
    const first = await session.listOffers(offerRequest(1, pageSize, noonStoreCode));
    const { total, hits } = validateOfferPayload(first);
    const pageCount = Math.ceil(total / pageSize);
    const rows = [...hits];
    for (let start = 2; start <= pageCount; start += concurrency) {
      const pages = Array.from({ length: Math.min(concurrency, pageCount - start + 1) }, (_, index) => start + index);
      const payloads = await Promise.all(pages.map((page) => session.listOffers(offerRequest(page, pageSize, noonStoreCode))));
      for (const payload of payloads) rows.push(...validateOfferPayload(payload).hits);
    }
    return writeInternalSnapshot({ rootDir, storeId, mode, catalogUrl: session.finalUrl, hits: rows, now });
  } finally {
    await session.close();
  }
}
```

实现中输出 `正在读取 API 第 X/Y 页，已获取 N 条商品...`，并以 `partner_sku + zsku_child + psku_code` 去重后写入 `exports/noon-catalog-sync`。

- [ ] **Step 4: 运行聚焦测试并确认通过**

Run: `node --test tests/noon-catalog-internal-sync.test.js`

Expected: PASS，所有内部同步用例通过。

---

### Task 2: CloakBrowser 内部 API 会话与启动脚本

**Files:**
- Create: `scripts/sync-noon-catalog-internal-api.js`
- Modify: `tests/noon-catalog-sync-source.test.js`

**Interfaces:**
- Consumes: `syncNoonCatalogFromInternalApi(options)`。
- Produces: CLI 参数 `--store-id`、`--mode`、`--catalog-url`、`--profile`。
- Produces: 浏览器会话方法 `getStoreCode()` 和 `listOffers(body)`，请求保持在 `noon-catalog.noon.partners` 同源页面内执行。

- [ ] **Step 1: 写启动脚本静态契约失败测试**

```js
test("internal catalog sync uses the selected store browser profile", async () => {
  const source = await readFile("scripts/sync-noon-catalog-internal-api.js", "utf8");
  assert.match(source, /\.noon-profiles/);
  assert.match(source, /noon-store\/list/);
  assert.match(source, /offer\/list\/noon/);
  assert.doesNotMatch(source, /STR517205-NSA/);
});
```

- [ ] **Step 2: 运行测试并确认因脚本不存在而失败**

Run: `node --test tests/noon-catalog-sync-source.test.js`

Expected: FAIL，错误指向缺少 `scripts/sync-noon-catalog-internal-api.js`。

- [ ] **Step 3: 实现最小浏览器启动脚本**

脚本使用现有 `cloakbrowser` 导入模式和 `normalizeNoonBrowserError`，打开所选项目 Catalog 页面。`getStoreCode()` 调用：

```js
await page.evaluate(async () => {
  const response = await fetch("/_vs/mp/mp-noon-merchant-api/noon-store/list", { credentials: "include" });
  if (!response.ok) throw new Error(`Noon Store 请求失败：HTTP ${response.status}`);
  return response.json();
});
```

`listOffers(body)` 使用同源 `fetch` POST 到 `/_vs/mp/mp-noon-catalog-api-rocket/offer/list/noon`，只传 `content-type: application/json`，不读取或打印凭据。登录页、资料占用和 API 错误转换为中文任务错误。

- [ ] **Step 4: 运行脚本契约和同步库测试**

Run: `node --test tests/noon-catalog-sync-source.test.js tests/noon-catalog-internal-sync.test.js`

Expected: PASS。

---

### Task 3: 任务来源校验与脚本路由

**Files:**
- Modify: `src/lib/jobs.ts`
- Modify: `tests/next-shell.test.js`

**Interfaces:**
- Consumes: 请求字段 `source: "internal_api" | "export"`。
- Produces: `internal_api` 启动 `scripts/sync-noon-catalog-internal-api.js`；`export` 启动 `scripts/sync-noon-catalog-api.js`。

- [ ] **Step 1: 写来源校验和路由失败测试**

```js
assert.match(jobsSource, /同步方案必须是 internal_api 或 export/);
assert.match(jobsSource, /scripts\/sync-noon-catalog-internal-api\.js/);
assert.match(jobsSource, /scripts\/sync-noon-catalog-api\.js/);
assert.match(workbenchSource, /source: "internal_api"/);
assert.match(workbenchSource, /source: "export"/);
```

- [ ] **Step 2: 运行测试并确认缺少双来源路由而失败**

Run: `node --test tests/next-shell.test.js`

Expected: FAIL，失败断言指向 `source` 或内部 API 脚本。

- [ ] **Step 3: 实现最小任务路由**

在 `startNoonCatalogSyncJob` 中：

```ts
const source = String(values.source || "").trim();
if (source !== "internal_api" && source !== "export") {
  throw new Error("同步方案必须是 internal_api 或 export。");
}
const script = source === "internal_api"
  ? "scripts/sync-noon-catalog-internal-api.js"
  : "scripts/sync-noon-catalog-api.js";
```

内部方案参数包含所选店铺 URL 和 `.noon-profiles/<storeId>` 相对路径；导出方案继续注入所选店铺 API token。`extra` 记录 `storeId`，不扩展任务持久化结构。`export` 现阶段仅接受 `mode=global`；`mode=fbn` 必须在服务端明确拒绝，前端同步禁用该组合。未来接入真实 FBN/FBP 导出源时继续复用 `source=export`，无需改变请求结构。

- [ ] **Step 4: 运行任务路由测试并确认通过**

Run: `node --test tests/next-shell.test.js`

Expected: PASS。

---

### Task 4: Noon 工作台双按钮与进度解析

**Files:**
- Modify: `src/app/noon-workbench/noon-workbench-workspace.tsx`
- Modify: `tests/next-shell.test.js`

**Interfaces:**
- Consumes: `startCatalogSync(source: "internal_api" | "export")`。
- Produces: 两个按钮 `API 快速同步`、`导出同步`，请求体显式传递 `source`。

- [ ] **Step 1: 写 UI 文案、参数和 API 进度失败测试**

```js
assert.match(workbenchSource, />API 快速同步</);
assert.match(workbenchSource, />导出同步</);
assert.match(workbenchSource, /正在读取 API 第/);
assert.doesNotMatch(workbenchSource, />重新同步</);
```

- [ ] **Step 2: 运行测试并确认旧单按钮界面导致失败**

Run: `node --test tests/next-shell.test.js`

Expected: FAIL，断言显示缺少双按钮或仍有不明确的“重新同步”。

- [ ] **Step 3: 实现双按钮和进度解析**

将启动函数签名改为：

```ts
type CatalogSyncSource = "internal_api" | "export";

async function startCatalogSync(source: CatalogSyncSource) {
  // ...
  body: JSON.stringify({ storeId, mode: catalogMode, source }),
}
```

顶部同步卡片渲染两个明确按钮；移除工具栏中不明确的“重新同步”。扩展 `parseSyncJobProgress`，从 `正在读取 API 第 current/total 页，已获取 count 条商品` 计算百分比，现有导出日志解析保持不变。

- [ ] **Step 4: 运行 UI 静态测试并确认通过**

Run: `node --test tests/next-shell.test.js`

Expected: PASS。

---

### Task 5: 回归与真实只读验证

**Files:**
- No production file changes expected.

**Interfaces:**
- Verifies: 内部 API 库、任务路由、页面请求契约、现有导出同步和 Next.js 构建。

- [ ] **Step 1: 运行相关单元测试**

Run: `node --test tests/noon-catalog-internal-sync.test.js tests/noon-catalog-api-sync.test.js tests/noon-catalog-sync-source.test.js tests/next-shell.test.js`

Expected: PASS，0 failures。

- [ ] **Step 2: 运行 TypeScript 检查**

Run: `npx tsc --noEmit`

Expected: exit 0。

- [ ] **Step 3: 运行 Next.js 生产构建**

Run: `npm run build:next`

Expected: exit 0，`/noon-workbench` 和 `/api/noon-catalog-sync-jobs` 构建成功。

- [ ] **Step 4: 使用已登录测试店铺进行受限只读验证**

为启动脚本提供测试用最大页数或通过库级注入只读取第一页和第二页，验证：

```text
总数 > 100000
第一页 hits = 100
第二页 hits = 100
快照包含 partner_sku、zsku_child、标题、价格/库存可用字段
日志不包含 Cookie、Authorization 或 APIJWT
```

若不执行完整 109337 条同步，在交付中明确说明完整耗时路径未实跑，不能声称全量端到端完成。

- [ ] **Step 5: 检查工作区差异**

Run: `git diff -- scripts/lib/noon-catalog-internal-sync.js scripts/sync-noon-catalog-internal-api.js src/lib/jobs.ts src/app/noon-workbench/noon-workbench-workspace.tsx tests/noon-catalog-internal-sync.test.js tests/noon-catalog-sync-source.test.js tests/next-shell.test.js docs/superpowers/specs/2026-07-12-noon-catalog-dual-sync-design.md docs/superpowers/plans/2026-07-12-noon-catalog-dual-sync.md`

Expected: 仅包含本方案要求的文件和改动；不提交、不推送。
