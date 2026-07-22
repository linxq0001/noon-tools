# Noon 工作台 Next.js 重写实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 沿用当前 Next.js 深色主题，将 `/noon-workbench` 页面布局复刻为旧版截图结构。

**Architecture:** 保留 `src/app/noon-workbench/page.tsx` 作为入口，重写 `noon-workbench-workspace.tsx` 中的布局与组件组合；复用并调整 `market-cards.tsx` 中的市场卡片；通过 `noon-workbench.css` 补充深色主题下的工作台专用样式。数据流复用现有 API 调用。

**Tech Stack:** Next.js 15 App Router, React 19, TypeScript, CSS Modules / 全局 CSS。

## Global Constraints
- 不引入新依赖。
- 不改动 API 与服务层。
- 不实现真实批量操作/跟卖监控逻辑，按钮保持 disabled 占位。
- 使用项目现有深色 CSS 变量。

---

## Task 1: 调整市场卡片组件以适配深色表格布局

**Files:**
- Modify: `src/components/noon/market-cards.tsx`
- Modify: `src/app/noon-workbench/noon-workbench.css`

**Interfaces:**
- Consumes: 现有 props（`Market`、`Tone`、`market`、`tone`、`title`、`value`、`lines`、`compact`、`text`、`status`、`reason`、`code`）
- Produces: 同名的 `MarketBadge`、`MarketMetric`、`MarketSource`、`OfferStatus`、`GlobalCard`，渲染结构保持兼容性

- [ ] **Step 1: 调整 `MarketMetric` 的 className 输出，移除浅色硬编码类**

`market-cards.tsx` 当前直接输出 `noon-market-card`、`noon-source-card` 等浅色类名。改为输出语义化类名（`market-card`、`market-source-card` 等），并把具体配色迁移到 `noon-workbench.css`，使用深色变量。

- [ ] **Step 2: 保留 `MarketBadge`、`MarketSource`、`OfferStatus`、`GlobalCard` 结构，仅更新 className**

- [ ] **Step 3: 在 `noon-workbench.css` 中添加深色市场卡片样式**

深色主题下：
- `.market-card`：面板背景、边框、市场徽章使用 `--color-info` / 米色占位。
- `.market-card.blue` 使用蓝色系（`--color-info` 相关变量）。
- `.market-card.cream` 使用暖色系（`--orange-500` / 黄褐色）。
- `.market-source-card` 使用橙色/琥珀色。
- `.market-offer-card` 使用红色/粉色。
- `.market-global-card` 使用绿色。

- [ ] **Step 4: 启动开发服务器并检查卡片渲染**

Run: `pnpm dev:next`
访问: `http://localhost:3000/noon-workbench`
Expected: 页面可打开，旧布局仍可见，无样式报错。

---

## Task 2: 重写工作台 Workspace 布局

**Files:**
- Modify: `src/app/noon-workbench/noon-workbench-workspace.tsx`
- Modify: `src/app/noon-workbench/page.tsx`（仅调整容器类名，如有必要）

**Interfaces:**
- Consumes: `/api/stores`, `/api/noon-catalog-sync?storeId=&mode=`, `/api/noon-catalog-sync-jobs`（POST）, `/api/upload-jobs/${id}`
- Produces: 页面 UI：CatalogCard、SummaryMetrics、BulkActionsBar、MonitorQuota、ProductTable、EmptyState

- [ ] **Step 1: 保留数据状态与副作用逻辑**

保留以下 state/effect 不变：
- `stores`, `storeId`
- `status`
- `catalogMode`
- `syncJobId`, `syncStatus`, `syncProgress`
- `catalogRows`, `catalogOutput`
- 三个 `useEffect`：加载店铺、切换店铺/模式刷新列表、轮询同步任务。
- `refreshCatalogRows()`
- `startCatalogSync()`
- `parseSyncJobProgress()`
- `parseJsonLog()`

- [ ] **Step 2: 按截图结构拆分 JSX**

新的 JSX 顺序：
1. `noon-catalog-hero`（商品目录卡片）
2. `noon-summary-grid`（汇总指标行：总销量 / 商品查看 / AE GMV / SA GMV）
3. `noon-bulk-bar`（批量操作栏）
4. `noon-monitor-quota`（跟卖监控配额进度条）
5. `noon-workbench-table`（商品表格）
6. `noon-empty-sync`（空状态）

- [ ] **Step 3: 实现汇总指标行**

使用四个指标卡：
```tsx
<div className="noon-summary-grid">
  <SummaryCard title="总销量" value="265件" meta="统计区间 2026-01-01 至 2026-07-03" />
  <SummaryCard title="商品查看" value="265" meta="来自 Noon Catalog 同步" />
  <SummaryCard title="阿联酋 (AE)" value="AED 0.00" meta="GMV - 退款/取消金额" />
  <SummaryCard title="沙特 (SA)" value="SAR 0.00" meta="GMV - 退款/取消金额" />
</div>
```
当前为静态数据；后续可接入真实统计。

- [ ] **Step 4: 实现跟卖监控配额**

```tsx
<div className="noon-monitor-quota">
  <div className="noon-quota-head">
    <strong>跟卖监控配额</strong>
    <span>0 / 10</span>
    <span>0%</span>
  </div>
  <div className="noon-progress-track">
    <span className="noon-progress-fill" style={{ width: "0%" }} />
  </div>
  <div className="noon-quota-foot">剩余 10 个配额</div>
</div>
```

- [ ] **Step 5: 实现商品表格**

表头使用 8 列：
```tsx
<div className="noon-sku-header-line">
  <span className="noon-sku-check"><input type="checkbox" /></span>
  <span>商品信息</span>
  <span>售价</span>
  <span>库存</span>
  <span>销售情况</span>
  <span>利润/规格</span>
  <span>状态</span>
  <span>跟卖监控</span>
  <span>操作</span>
</div>
```

每行渲染：
- 复选框
- 商品信息：封面图 + 标题 + PSKU/SKU + 品牌/来源
- 售价：`MarketMetric` AE/SA 买家最终价
- 库存：`MarketMetric` AE/SA 总计
- 销售情况：`MarketMetric` AE/SA 销量
- 利润/规格：`MarketSource` AE/SA 未关联 Noon 大师货源
- 状态：`OfferStatus` AE/SA 下线/停用
- 跟卖监控：占位
- 操作：删除按钮

- [ ] **Step 6: 移除旧的 `MarketOverview` 引用**

旧版 workspace 中的 `<MarketOverview />` 不再使用，删除 import 与 JSX。

---

## Task 3: 补充深色主题工作台 CSS

**Files:**
- Modify: `src/app/noon-workbench/noon-workbench.css`

- [ ] **Step 1: 添加汇总指标卡样式**

```css
.noon-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 12px;
}

.noon-summary-card {
  padding: 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-panel);
  box-shadow: var(--shadow-card);
}

.noon-summary-card span {
  display: block;
  color: var(--color-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.noon-summary-card strong {
  display: block;
  margin-top: 8px;
  color: var(--color-heading);
  font-size: var(--text-2xl);
  font-weight: var(--weight-bold);
}

.noon-summary-card small {
  display: block;
  margin-top: 6px;
  color: var(--color-muted);
  font-size: var(--text-xs);
}
```

- [ ] **Step 2: 添加跟卖监控配额样式**

```css
.noon-monitor-quota {
  padding: 14px 16px;
  border: 1px solid var(--color-border);
  border-radius: var(--radius);
  background: var(--color-panel);
  box-shadow: var(--shadow-card);
}

.noon-quota-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 10px;
}

.noon-quota-head strong {
  color: var(--color-heading);
  font-size: var(--text-base);
}

.noon-quota-head span {
  color: var(--color-muted);
  font-size: var(--text-sm);
  font-weight: var(--weight-semibold);
}

.noon-quota-foot {
  margin-top: 8px;
  color: var(--color-muted);
  font-size: var(--text-sm);
}
```

- [ ] **Step 3: 调整表格布局样式**

确保表格行能容纳 AE/SA 双市场信息，使用 flex/grid 分组。表头固定，行内单元格使用深色面板卡片风格。

- [ ] **Step 4: 添加响应式回退**

在窄屏下将汇总指标卡、表格行改为垂直堆叠。

---

## Task 4: 清理未使用组件

**Files:**
- Delete: `src/components/noon/market-overview.tsx`
- Delete: `src/components/noon/market-overview.module.css`

- [ ] **Step 1: 确认无其他文件引用 `MarketOverview`**

Run: `rg "MarketOverview" src/ --type tsx --type ts`
Expected: 仅在 `market-overview.tsx` 自身有命中。

- [ ] **Step 2: 删除上述两个文件**

---

## Task 5: 构建与验证

**Files:**
- All modified files above

- [ ] **Step 1: 类型检查**

Run: `pnpm typecheck` 或 `npx tsc --noEmit`
Expected: 无 TypeScript 错误。

- [ ] **Step 2: 构建**

Run: `pnpm build:next`
Expected: 构建成功。

- [ ] **Step 3: 启动预览并截图**

Run: `pnpm start:next`（或 `pnpm dev:next`）
访问: `http://localhost:3000/noon-workbench`
Expected: 页面结构与截图一致；若有同步数据则表格展示商品；若无数据则显示空状态。

---

## Spec Coverage Check
- 商品目录卡片：Task 2 Step 2
- 汇总指标行：Task 2 Step 3 + Task 3 Step 1
- 批量操作栏：Task 2 Step 2（保留现有 toolbar）
- 跟卖监控配额：Task 2 Step 4 + Task 3 Step 2
- 商品表格：Task 2 Step 5 + Task 3 Step 3
- 深色主题：Task 1 + Task 3
- 保留数据流：Task 2 Step 1
- 不改动 API：Global Constraints
