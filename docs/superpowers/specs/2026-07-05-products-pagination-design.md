# 商品仓库分页加载设计

## 背景

当前 `GET /api/products` 会一次性遍历所有 1688 仓库，读取每个商品的 `meta.json`、`noon-product-attributes.json` 和上传状态，并返回所有仓库的完整 `products` 数组。前端再在浏览器里分页。

当前本机约 153 个商品时接口响应约 914KB，仍可接受；但这个结构会随商品数线性膨胀。仓库增长到上千商品后，接口响应、文件读取、浏览器内存和首屏渲染都会变重。

## 目标

- 首屏不再下载所有商品详情。
- 仓库摘要和商品列表分离。
- 商品列表按仓库、页码、筛选条件按需加载。
- 保留现有本地 JSON 文件存储，不引入数据库或新依赖。
- 尽量复用现有 `readProductSummary`、`buildRepositorySummary`、上传状态和汇总逻辑。

## 非目标

- 不重做商品存储结构。
- 不引入服务端缓存层。
- 不改变 `products/` 目录约定。
- 不重写 Noon Catalog 同步工作台。
- 不处理虚拟滚动或复杂表格组件。

## 接口设计

### `GET /api/repositories`

用于首屏加载仓库摘要。

Query:

- `storeId`: 可选，保持当前按店铺读取上传状态的能力。

Response:

```json
[
  {
    "id": "default",
    "name": "默认仓库",
    "productCount": 20,
    "imageCount": 120,
    "uploadableCount": 18,
    "blockedCount": 2,
    "updatedAt": "2026-07-05T00:00:00.000Z",
    "uploadStatus": {},
    "globalBulkUpdate": {}
  }
]
```

这个接口不返回 `products` 数组。

### `GET /api/products`

用于加载当前仓库的当前页商品。

Query:

- `repository`: 必填，仓库 ID。
- `page`: 可选，默认 `1`。
- `pageSize`: 可选，默认 `20`，最大 `100`。
- `storeId`: 可选，读取对应店铺上传状态。
- `status`: 可选，上传状态筛选；`all` 或空值表示不过滤。
- `q`: 可选，搜索商品标题、目录、Noon 标题或 SKU。

Response:

```json
{
  "repository": {
    "id": "default",
    "name": "默认仓库"
  },
  "products": [],
  "pagination": {
    "page": 1,
    "pageSize": 20,
    "totalItems": 20,
    "totalPages": 1
  }
}
```

## 后端数据流

1. `readPlatformRepositories(productsDir, "1688")` 继续作为仓库来源。
2. 新增仓库摘要读取逻辑：遍历仓库目录，计算摘要字段，但不附带完整 `products`。
3. 商品分页接口先定位目标仓库，再对 `repository.productDirs` 做筛选和分页。
4. 只对当前页商品调用 `readProductSummary(relativeDir, repository.id, storeId)`。
5. 搜索和状态筛选在服务端完成，避免前端需要完整商品数组。

为保持实现简单，`q` 搜索可以先读取候选商品摘要后过滤。它仍比全量接口轻，因为只发生在当前仓库内，并且不返回其它仓库商品。

## 前端数据流

1. `refreshProducts()` 改为先请求 `/api/repositories`。
2. 选择仓库、翻页、改变状态筛选、搜索时，请求 `/api/products`。
3. `renderProductPage` 不再假设仓库对象带完整 `products`。
4. 上传页保留当前客户端分页 UI，但数据来源改为服务端分页结果。
5. 批量上传本仓库时不能依赖当前页商品数组；前端向上传任务传 `repository`，由后端展开该仓库的所有 `productDir`。
6. Noon Catalog 同步相关的运营工作台继续使用 `/api/noon-catalog-sync`，不纳入本次分页改造。

## 错误处理

- 缺少 `repository` 时返回 `400`。
- 找不到仓库时返回 `404`。
- `page` 小于 1 时按 1 处理。
- `pageSize` 小于 1 时按默认值处理，大于 100 时按 100 处理。
- 单个商品读取失败时沿用现有摘要：标题使用目录名，并包含 `meta.json 不可读取` 警告。

## 验证方式

- 新增或调整后端测试，覆盖：
  - `/api/repositories` 不返回商品详情数组。
  - `/api/products` 按仓库分页。
  - `pageSize` 上限。
  - 搜索和状态筛选。
  - 仓库不存在。
- 调整前端相关测试，确认 `refreshProducts` 使用新接口，并在仓库切换和翻页时请求分页数据。
- 手动验证：
  - 打开 `http://127.0.0.1:4173`。
  - 首屏加载后仓库统计正确。
  - 仓库页只加载当前页商品。
  - 翻页、搜索、状态筛选正常。
  - 上传单个商品、上传选中商品仍能使用正确 `productDir`。

## 成功标准

- `/api/products` 不再默认返回所有仓库所有商品。
- 首屏请求体积与商品总数解耦，只随仓库数量增长。
- 单个仓库翻页请求体积随 `pageSize` 增长，而不是随仓库总商品数增长。
- 现有商品上传、批量导出和 Noon Catalog 同步入口不因分页改造失效。
