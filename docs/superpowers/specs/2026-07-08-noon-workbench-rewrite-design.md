# Noon 工作台 Next.js 重写设计

## 背景
旧版单页应用（`public/index.html`，运行于 `localhost:4173/#noon-workbench`）在加载 Noon Catalog 数据后展示「Noon 工作台」。本项目已在 `src/app/noon-workbench/` 提供 Next.js 版本，但视觉布局与旧版差异较大。本次任务要求沿用当前 Next.js 深色主题，复刻旧版截图中的布局与信息结构。

## 目标
将 `/noon-workbench` 页面改造为与旧版截图一致的信息布局，同时保留现有数据获取与同步能力。

成功标准：
1. 页面打开后展示商品目录卡片、汇总指标行、批量操作栏、跟卖监控配额、商品表格。
2. 表格列与截图一致：商品信息 / 售价 / 库存 / 销售情况 / 利润/规格 / 状态 / 跟卖监控 / 操作。
3. 行内按 AE / SA 双市场展示价格、库存、销量、状态。
4. 同步 SKU、刷新数据、模式切换等现有功能继续可用。
5. 通过 `pnpm build:next` 与 `pnpm lint`（如配置）检查。

## 方案
沿用现有深色主题，复刻旧版布局。

## 变更范围
- `src/app/noon-workbench/page.tsx`
- `src/app/noon-workbench/noon-workbench-workspace.tsx`
- `src/app/noon-workbench/noon-workbench.css`（按需补充深色主题下的工作台专用样式）
- `src/components/noon/market-cards.tsx`（按需调整以适配深色表格布局）
- `src/components/noon/market-overview.tsx` / `market-overview.module.css`（如不再使用则删除）

不改动 API 与数据服务：
- `src/app/api/noon-catalog-sync/route.ts`
- `src/app/api/noon-catalog-sync-jobs/route.ts`
- `src/lib/noon-catalog-sync.ts`

## 组件结构

### 1. 页面头部（PageHeader）
- 左侧：`page-kicker` 显示 "NOON OPERATIONS"，`page-title` 显示 "Noon 工作台"。
- 右侧：「刷新商品」按钮，触发 `refreshCatalogRows()`。

### 2. 商品目录卡片（CatalogCard）
- 标题：商品目录
- 副标题：管理 Noon SKU、批量调价、改库存、改时效。批量操作后通常需要等待 1-3 分钟在 Noon 生效。
- 右上角：Catalog Manager 徽章
- 模式切换：FBN/FBP 模式 / Global (NGS) 模式，受 `catalogMode` state 控制
- 配置提示：默认跟随仓库 & 运费配置
- 同步状态区：显示当前状态或首次使用提示
- 同步 SKU 按钮：触发 `startCatalogSync()`
- 同步进度条（仅在 `syncStatus === "running"` 时显示）

### 3. 汇总指标行（SummaryMetrics）
四个指标卡横向排列：
- 总销量：265件 / 统计区间 2026-01-01 至 2026-07-03
- 商品查看：265 / 来自 Noon Catalog 同步
- 阿联酋（AE）：AED 0.00 / GMV - 退款/取消金额
- 沙特（SA）：SAR 0.00 / GMV - 退款/取消金额

当前数据来自同步结果；若暂无数据则显示 0。

### 4. 批量操作栏（BulkActionsBar）
- 左侧：复选框（选择本页）+ 已选择 N 个商品
- 右侧：批量改商品属性 / 批量调价 / 批量改 FBP/NGS 库存 / 批量改时效 / 重新同步 / 导出 Global 表 / 取消选择 / 批量删除
- 当前无实际选择逻辑，按钮默认 disabled（保留与旧版一致的占位交互）。

### 5. 跟卖监控配额（MonitorQuota）
- 标题：跟卖监控配额
- 当前配额：0 / 10
- 进度条：0%
- 剩余：10 个配额

当前为静态展示；后续可接入真实配额 API。

### 6. 商品表格（ProductTable）
- 表头：复选框 + 商品信息 / 售价 / 库存 / 销售情况 / 利润/规格 / 状态 / 跟卖监控 / 操作
- 每行数据来自 `catalogRows`：
  - 商品信息：封面图（如无可占位图）+ 标题 + PSKU + SKU + 品牌/来源
  - 售价：AE/SA 买家最终价（AED/SAR），附带 USD/CNY 换算
  - 库存：AE/SA 总计与 NGS/FBN/FBP 数量
  - 销售情况：AE/SA 销量/浏览 + 销售额 + 取消/退货
  - 利润/规格：AE/SA 未关联 Noon 大师货源
  - 状态：AE/SA 下线/卖家停用/no_offer
  - 跟卖监控：占位
  - 操作：删除按钮
- 无数据时显示空状态：提示同步 SKU。

## 数据流
1. 组件挂载时拉取 `/api/stores`，设置默认店铺。
2. `storeId` 或 `catalogMode` 变化时，调用 `refreshCatalogRows()` 读取 `/api/noon-catalog-sync`。
3. 点击「同步 SKU」调用 `/api/noon-catalog-sync-jobs` 创建任务，轮询 `/api/upload-jobs/${id}` 直至完成或失败。
4. 同步完成后再次刷新列表。

## 样式约定
- 使用项目已有的 CSS 变量：`--color-panel`、`--color-heading`、`--color-muted`、`--color-border`、`--color-primary`、`--color-info` 等。
- 工作台页面通过 `noon-workbench-page` 类保留局部样式覆盖能力。
- 指标卡、表格行使用现有深色卡片风格（边框 + 阴影 + 面板背景）。
- 按钮使用项目全局 `button` 样式；disabled 状态保持现有处理。

## 不做的范围
- 不引入新依赖。
- 不改写 API 或服务层。
- 不实现真实的批量操作、跟卖监控逻辑（保持现有占位按钮）。
- 不做全局主题切换或浅色主题支持。

## 验收检查
- [ ] `pnpm build:next` 通过
- [ ] `pnpm lint` 通过（如项目已配置）
- [ ] 页面在 `/noon-workbench` 正常渲染
- [ ] 同步 SKU 后表格正确展示数据
