# Next.js 阶段一迁移设计

## 背景

当前 `noon-tools` 是本地运营工具，入口是 `npm run ui` 启动 `scripts/server.js`，浏览器页面由单个 `public/index.html` 承载。这个结构已经能运行采集、生成、上传、仓库、店铺和批量更新流程，但 UI 与 API 都集中在大文件中，后续页面拆分、状态管理和验证会越来越难。

本阶段不做一次性重写。Next.js 先作为新的本地 UI/API 壳子加入项目，保留现有业务脚本、文件数据和旧 UI。第一条端到端迁移链路选择 settings，因为它风险低、路径清晰，并且能验证 Next API 读写本地 JSON 文件的方式。

## 目标

- 新增 Next.js App Router 基础结构。
- 新增本地 Next 开发入口，不替换现有 `npm run ui`。
- 抽出 `.ui-settings.json` 读写逻辑，供旧 server 和新 Next API 共享。
- 新增 `GET /api/settings` 和 `POST /api/settings` 的 Next Route Handler。
- 新增简洁 settings 页面，能读取、编辑并保存现有配置字段。
- 保持 `products/`、`exports/`、`.ui-settings.json`、`.noon-stores.json` 的路径兼容。

## 非目标

- 不迁移采集、上传、Noon 同步、商品仓库或店铺管理页面。
- 不删除 `public/index.html` 或 `scripts/server.js`。
- 不引入 Prisma、PostgreSQL、Auth.js、TanStack Query、Zustand 或任务队列。
- 不把本地工具部署到 Vercel Serverless。
- 不重构 `scripts/lib` 中的业务逻辑。

## 架构

新增 `src/app` 作为 Next App Router 入口，阶段一只包含首页、settings 页面和 settings API。首页提供简洁导航，明确这是 Next 迁移壳，不承载旧页面功能。

新增 `src/lib/settings.ts` 作为共享设置模块。它只负责 `.ui-settings.json` 的路径定位、字段白名单、读取、合并写入和更新时间，不包含页面逻辑。旧 `scripts/server.js` 后续可以改为复用这个模块；阶段一先保证 Next API 与旧 API 使用同一份文件契约。

Next 服务按本地 Node 服务运行。现有 `npm run ui` 保留给旧工具，新增 `npm run dev:next` 启动 Next 开发服务，避免迁移未完成时影响当前工作流。

## Settings 字段契约

Settings 模块只保存当前旧 UI 已允许保存的字段：

- `url`
- `limit`
- `headless`
- `storageState`
- `deepseekApiKey`
- `deepseekModel`
- `ocrLanguage`
- `ocrProvider`
- `uploadProductDir`
- `uploadHeadless`
- `uploadStorageState`
- `uploadStoreId`
- `defaultStoreId`

所有传入值按字符串保存。未知字段丢弃。保存时保留已有字段并更新 `updatedAt`。

## 页面设计

`src/app/settings/page.tsx` 使用一个客户端表单组件。页面加载时请求 `/api/settings`，表单提交时 POST 同一路径。界面保持本地工具风格：密集、克制、明确，不做营销页或大改版。

页面分三组：

- 1688 采集环境：`url`、`limit`、`headless`、`storageState`
- Noon 上传设置：`uploadProductDir`、`uploadHeadless`、`uploadStorageState`、`uploadStoreId`
- AI/OCR 设置：`deepseekApiKey`、`deepseekModel`、`ocrProvider`、`ocrLanguage`

`defaultStoreId` 暂不放到独立店铺管理体验里，只作为兼容字段保留。

## 错误处理

- `.ui-settings.json` 不存在或 JSON 损坏时，读取返回 `{}`。
- POST body 不是对象时按空对象处理。
- 写入失败时 Next API 返回 `500` 和错误信息。
- 前端保存失败时在页面内展示错误，不隐藏失败。

## 验证方式

- 新增 `node:test` 覆盖 settings 模块：
  - 缺失文件时返回 `{}`。
  - 保存时只保留白名单字段。
  - 保存时保留已有字段并更新 `updatedAt`。
- 新增静态测试覆盖 Next 壳：
  - `package.json` 有 `dev:next`、`build:next`、`start:next` 脚本。
  - `src/app/api/settings/route.ts` 调用共享 settings 模块。
  - `src/app/settings/page.tsx` 存在。
- 执行 `npm test`。
- 执行 `npm run build:next`，确认 Next 项目可构建。

## 成功标准

- 旧 `npm run ui` 入口仍保留。
- 新 `npm run dev:next` 可以启动 Next 壳子。
- Next settings API 读写同一份 `.ui-settings.json`。
- 新 settings 页面能完成读取和保存。
- 没有迁移或破坏采集、上传、商品仓库、店铺管理和 Noon 同步流程。
