# 商品素材本地存放方案

## 目标

商品素材以本地文件系统作为主工作副本，服务 1688 采集、noon 属性生成、上传和批量导出。当前不做外部备份，不把 `products/` 作为源码提交内容。

成功标准：

- 商品身份稳定，可重复采集。
- 仓库支持批量下载分组。
- 可以按平台筛选所有仓库。
- 上传/导出只处理通过本地技术校验的商品。
- 索引可重建，不成为唯一数据源。

## 目录结构

最终结构：

```text
products/
  1688/
    index.json
    default/
      repository.json
      index.json
      958239268713/
        meta.json
        noon-product-attributes.json
        images/
          001.jpg
          002.jpg

    2026-06-09-evening-bags/
      repository.json
      collection-queue.json
      index.json
      900214398574/
      958239268713/
```

规则：

- 路径层级为 `products/<platform>/<repositoryId>/<productId>/`。
- 当前只实现 `platform = 1688`。
- 单商品采集默认写入 `products/1688/default/<productId>/`。
- 批量列表采集必须写入独立仓库；用户未填写仓库时自动生成。
- 商品目录名只使用 `productId`，不带标题。
- 商品标题、来源标题等可读信息写入 JSON。

## 仓库模型

每个仓库都必须有 `repository.json`，包括 `default` 仓库。

示例：

```json
{
  "id": "2026-06-09-evening-bags",
  "name": "晚宴包第1批",
  "platform": "1688",
  "sourceListUrl": "https://...",
  "createdAt": "2026-06-09T00:00:00.000Z",
  "kind": "batch"
}
```

`default` 示例：

```json
{
  "id": "default",
  "name": "默认仓库",
  "platform": "1688",
  "createdAt": "2026-06-09T00:00:00.000Z",
  "kind": "default"
}
```

规则：

- `repositoryId` 是稳定目录 ID，只允许安全路径字符。
- 展示名写入 `repository.json.name`，可以是中文。
- 手动指定已存在的 `repositoryId` 时复用该仓库。
- 自动生成的 `repositoryId` 如果冲突，追加序号创建新仓库。
- 不支持移动商品到另一个仓库。
- 不支持复制商品到另一个仓库。
- 仓库选错时，只支持显式删除后在目标仓库重新采集。
- 支持删除仓库；空仓库可直接删除，非空仓库必须显式确认仓库 ID。
- 工具内不做回收站。

## 商品身份与重复

规则：

- 一个 `productId` 在同一仓库内只能有一个目录。
- 重复采集同一仓库内同一 `productId` 时，覆盖当前版本。
- 同一个 1688 商品可以存在于多个仓库。
- 跨仓库重复商品是仓库内副本，不是新的商品身份。
- SKU 和 barcode 不包含仓库 ID。
- 同一个 `productId` + 同一个 variant 跨仓库保持相同 `partner_sku` 和 `barcode`。

跨仓库批量导出规则：

- 导出 `Global Product Update` / `Global Price Update` / `Stock Import` 前，先按商品身份去重。
- 商品身份优先使用商品目录名开头的数字 `productId`，例如 `1003916523617-小方包` 和 `1003916523617-孔雀镶钻手拿包` 视为同一个商品。
- 同一个 `productId` 出现在多个仓库或旧目录中时，保留排序后的第一份商品，其余来源记录为 `duplicateProducts`，不进入三张导出表。
- 商品级去重后，再做 SKU 级去重。
- 同一个商品文件内部出现重复 SKU 时，保留第一行 variant，后续重复行记录为 `duplicateSkus`，不中断导出。
- 同 SKU 在多个仓库出现且关键内容一致时，自动去重并报告重复来源。
- 同 SKU 在多个仓库出现但关键内容不一致时，阻止导出并标记冲突。
- 三张导出表的成功标准一致：每个 `partner_sku` 最多出现一次，且被识别为重复商品的来源不会出现在任何一张表中。

关键内容至少包括：

- `partner_sku`
- `barcode`
- `colour`
- `price`
- `stock`
- dimensions
- weight
- `title_en`
- `title_ar`
- images

## 图片规则

当前只保存一套图片，偏上传可用。

```text
images/
  001.jpg
  002.jpg
  003.jpg
```

规则：

- 图片文件名保持顺序号，例如 `001.jpg`。
- 不在文件名中写颜色、主图、用途等语义。
- 颜色、角色、上传顺序、来源 URL 写入 JSON。
- 唯一保存的图片集应尽量满足 noon / Google Drive / NIS 上传使用。
- 原始图片二进制副本不单独保存。
- 原始来源 URL、content type、过滤原因、失败下载原因必须保留在 JSON 中，便于重新采集。

## JSON 职责

`meta.json` 只保存来源事实和本地素材事实。

示例字段：

```json
{
  "source": "1688",
  "productId": "958239268713",
  "sourceUrl": "https://detail.1688.com/offer/958239268713.html",
  "sourceTitle": "...",
  "title": "...",
  "attributes": {},
  "price": "38.00",
  "status": "ready",
  "collectedAt": "2026-06-09T00:00:00.000Z",
  "images": [
    {
      "path": "images/001.jpg",
      "sourceUrl": "https://...",
      "contentType": "image/jpeg",
      "uploadOrder": 1
    }
  ],
  "blockingIssues": [],
  "warnings": []
}
```

`noon-product-attributes.json` 只保存 noon 目标数据。

示例字段：

```json
{
  "product_group": {},
  "variants": [
    {
      "partner_sku": "1688-958239268713-SILVER",
      "barcode": "...",
      "colour": "Silver",
      "images": [
        {
          "path": "images/001.jpg"
        }
      ]
    }
  ]
}
```

规则：

- 采集事实不塞进 noon 目标数据。
- noon 文案、SKU、barcode、仓库、NIS 字段不塞进 `meta.json`。
- 人工修改短期直接落在 `noon-product-attributes.json`。
- 重新生成 noon 数据时，不允许静默覆盖已有 `noon-product-attributes.json`；必须显式 `--force` 或先备份。

## 状态与 ready gate

状态写入 JSON，不通过移动目录表达。

状态语义：

- `draft`: 已生成，但未通过上传条件或尚未完成生成。
- `ready`: 通过本地技术校验，可以进入上传/导出队列。
- `needs_review`: 字段基本存在但有质量警告，或图片/颜色分配不可靠。
- `failed`: 关键素材缺失，不能上传。

允许自动设置 `ready`，但 `ready` 只代表通过本地技术校验，不代表内容质量完美。

自动 ready 最低校验：

- `meta.json` 有 `sourceUrl`、`productId`、`title`、`price`、`collectedAt`。
- 至少 3 张本地图片存在。
- noon 引用的图片路径都存在。
- `noon-product-attributes.json` 有 `product_group`。
- 至少 1 个 variant。
- 每个 variant 有 `partner_sku`、`barcode`、`colour`、`title_en`、`title_ar`、price、stock、dimensions、weight。
- `partner_sku` 在当前本地 `products/` 全量目录内唯一，重复副本导出时按冲突规则处理。
- `barcode` 在当前本地 `products/` 全量目录内唯一，重复副本导出时按冲突规则处理。
- 没有 blocking issues。

失败或不完整采集也写入商品目录，但必须标记为 `needs_review` 或 `failed`。上传和导出默认只处理 `ready` 商品。

## 索引

索引是派生文件，可重建，不作为主数据源。

文件：

```text
products/1688/<repositoryId>/index.json
products/1688/index.json
```

后续多平台时可以增加：

```text
products/index.json
```

规则：

- 仓库级 `index.json` 汇总当前仓库商品。
- 平台级 `index.json` 汇总该平台下所有仓库。
- 主数据仍以每个商品目录中的 `meta.json` 和 `noon-product-attributes.json` 为准。

## 队列

`collection-queue.json` 属于具体仓库。

```text
products/1688/<repositoryId>/collection-queue.json
```

规则：

- 批量列表采集先创建或确定仓库，再创建队列。
- 继续未完成队列时，只继续当前仓库的队列。
- 不放平台级队列。
- `default` 仓库通常不需要队列。

## Git 与备份

规则：

- `products/` 是本地业务数据，不进入 Git。
- Git 只管理代码、模板、测试、文档和少量 fixture。
- 当前不做 Google Drive 或其他外部备份。
- 每个商品必须保存 `sourceUrl`、原始图片 URL 映射和 `collectedAt`，用于本地丢失后重新采集。

## 旧结构兼容

当前已有旧结构：

```text
products/<productId>-<title>/
products/<repository>/<productId>-<title>/
```

迁移策略：

- 短期保留旧结构读取兼容。
- 新采集只写新结构 `products/<platform>/<repositoryId>/<productId>/`。
- 暂不强制搬迁旧目录。
- 后续可以单独提供迁移命令，但不作为当前方案的一部分。
