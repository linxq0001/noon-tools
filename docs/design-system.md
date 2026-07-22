# Noon Tools 设计系统规范

本规范基于 `src/app/globals.css` 的设计令牌（design tokens）。所有新页面与组件必须使用这些令牌，禁止硬编码像素值或色值。

## 1. 字体

- **UI 字体**：`var(--font-ui)` (Geist Sans)，通过 `next/font` + `geist` 包加载。
- **显示字体**：`var(--font-display)` (Sora)，通过 `next/font/google` 加载，仅用于工作台首页等需要科技感大标题的区域。
- **等宽字体**：`var(--font-mono)` (Geist Mono)，用于数字、SKU、ID、日志、代码。
- 字体变量在 `src/app/layout.tsx` 中通过 `GeistSans.variable` / `GeistMono.variable` / `--font-sora` 注入 `<body>`。

### 字号比例（type scale）

| 令牌 | 值 | 用途 |
|---|---|---|
| `--text-xs` | 11px | 角标、辅助元信息 |
| `--text-sm` | 12px | 次要标签、说明、表头 |
| `--text-base` | 13px | 正文、按钮、表格行 |
| `--text-md` | 14px | 强调正文、导航项、列表项 |
| `--text-lg` | 15px | 卡片标题、字段标签 |
| `--text-xl` | 16px | 面板标题、面板小标题 |
| `--text-2xl` | 18px | 对话框标题、区块标题 |
| `--text-3xl` | 20px | 页面标题 |
| `--text-4xl` | 24px | 数据指标大数 |
| `--text-display` | 28px | 品牌、页面大标题 |

### 字重

| 令牌 | 值 | 用途 |
|---|---|---|
| `--weight-regular` | 400 | 正文 |
| `--weight-medium` | 500 | 次要强调 |
| `--weight-semibold` | 600 | 按钮、标签、导航 |
| `--weight-bold` | 700 | 标题、数据值 |

### 行高

| 令牌 | 值 | 用途 |
|---|---|---|
| `--leading-none` | 1 | 大数字、徽章 |
| `--leading-tight` | 1.2 | 标题 |
| `--leading-snug` | 1.35 | 多行标题、紧凑文本 |
| `--leading-normal` | 1.5 | 正文、说明文字 |
| `--leading-loose` | 1.55 | 日志、长文本 |

**规则**：任何 `font-size` / `font-weight` / `line-height` 必须使用令牌，不得写裸像素值。

## 2. 颜色

### 语义令牌（优先使用）

| 令牌 | 含义 |
|---|---|
| `--color-bg` | 页面背景 (`--gray-100`) |
| `--color-panel` | 卡片、面板、侧栏背景 (`--gray-0`) |
| `--color-text` | 正文文字 |
| `--color-heading` | 标题文字 |
| `--color-muted` | 次要说明文字 |
| `--color-subtle` | 占位、极次要文字 |
| `--color-border` | 默认边框 |
| `--color-border-strong` | hover / 强调边框 |
| `--color-primary` | 主品牌色 / 主按钮 (蓝) |
| `--color-primary-text` | 主按钮文字 (白) |
| `--color-info` | 信息态、链接 |
| `--color-info-bg` | 信息态底色 |
| `--color-accent` | 选中 / 成功强调 (绿) |
| `--color-success` / `--color-success-bg` | 成功态 |
| `--color-warning` / `--color-warning-bg` | 警告态 |
| `--color-danger` / `--color-danger-bg` / `--color-danger-text` | 危险/删除 |

### 色调底色（tone tokens）

用于带轻微着色的区块背景，避免硬编码 hex：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--tone-accent-bg` | `#edf7f4` | 选中店铺、保存徽章 |
| `--tone-info-bg` | `#f6f9ff` | 信息提示、表头底色 |
| `--tone-info-strong` | `#edf3ff` | 序号圆点、强信息底 |
| `--tone-neutral-bg` | `#f3f6fb` | 中性状态底色 |
| `--tone-log-bg` | `#101820` | 日志终端深色底 |

**规则**：全页色彩一致性锁（color consistency lock）。主品牌色为蓝 (`--color-primary`)，强调色为绿 (`--color-accent`)。整站不得出现这两种以外的随机强调色。状态色（info/success/warning/danger）仅用于对应语义场景。

## 3. 间距

| 令牌 | 值 |
|---|---|
| `--space-1` | 4px |
| `--space-2` | 6px |
| `--space-3` | 8px |
| `--space-4` | 10px |
| `--space-5` | 12px |
| `--space-6` | 14px |
| `--space-7` | 16px |
| `--space-8` | 18px |
| `--space-9` | 22px |
| `--space-10` | 24px |
| `--space-11` | 32px |

**规则**：所有 `margin` / `padding` / `gap` 使用令牌。区块间距用 `--space-9` 至 `--space-11`，组件内用 `--space-3` 至 `--space-7`。

## 4. 圆角与形状

全站形状一致性锁（shape consistency lock）：

| 令牌 | 值 | 用途 |
|---|---|---|
| `--radius-sm` | 6px | 输入框、小按钮、序号 chip |
| `--radius` | 8px | 卡片、面板、按钮（默认） |
| `--radius-md` | 10px | 強调按钮 |
| `--radius-lg` | 12px | 大卡片 |
| `--radius-pill` | 999px | 徽章、状态标签、导航 accent |

**规则**：禁止写裸 `border-radius` 像素值。卡片/面板统一用 `--radius`，徽章/标签统一用 `--radius-pill`。

## 5. 阴影

| 令牌 | 值 | 用途 |
|---|---|---|
| `--shadow-card` | `0 1px 3px ..., 0 8px 22px ...` | 卡片、面板 |
| `--shadow-float` | `0 12px 24px rgba(29,111,232,0.2)` | 主操作按钮、上传按钮 |

阴影色调已染向背景色相（蓝灰），禁止使用纯黑 drop shadow。

## 6. 布局规范

### 整体框架

- `.shell`：`grid-template-columns: 248px minmax(0, 1fr)`，左侧固定侧栏 + 右侧内容区。
- `.rail`：`position: sticky; height: 100vh`，品牌区 + 导航 + 底部状态。
- `.content`：`min-width: 0`（防止 grid 溢出）。

### 页面容器

| 类 | 宽度 | 用途 |
|---|---|---|
| `.page-shell` | `min(1120px, calc(100% - 48px))` | 普通页面（工作台、配置、店铺） |
| `.product-page-shell` | `min(1440px, calc(100% - 32px))` | 商品详情 |
| `.repository-page-shell` | `min(1760px, calc(100% - 32px))` | 商品仓库（宽表格） |

### 页头

- `.page-head`：flex 两端对齐，`margin-bottom: var(--space-9)`。
- `.page-kicker`：小号大写字母标签（`text-transform: uppercase; letter-spacing: 0.02em`）。
- `.page-title`：`--text-3xl` (20px)，`letter-spacing: -0.01em`。

### 卡片 / 面板

- 白底 (`--color-panel`) + `1px solid var(--color-border)` + `--radius` + `--shadow-card`。
- 仅在需要层级时使用卡片；信息分组优先用 `border-t` / `divide-y` / 留白。
- `.workspace-card` 带 hover 上浮 (`translateY(-2px)`) 与阴影增强，作为可点击入口卡片的统一交互。
- 工作台首页采用独立的深色科技风 (`wb-*` 类族，scoped 于 `.wb-page`)：仅用于首页，复用 `--font-display`、`--font-mono` 与 `--radius-*` 令牌；强调色单一锁定为 `--wb-accent` (teal)；所有动效受 `prefers-reduced-motion` 保护。组件实现位于 `src/components/workbench/workbench-home.tsx`。

### 按钮

- 默认按钮：`min-height: 34px`，`--radius-sm`，主色背景。
- `button.secondary` / `button.ghost`：白底 + 文字色。
- `button.danger`：危险底色 + 危险文字色。
- `:active` 用 `translateY(1px)` 模拟按压。
- 禁用态：`opacity: 0.5; cursor: not-allowed`。

### 表单

- label 在 input 上方。input 高度 `38px`，`--radius-sm`，focus 用 `box-shadow: 0 0 0 3px rgba(79,124,255,0.15)`。
- 禁止用 placeholder 代替 label。

### 响应式

- `< 760px`：所有多列布局塌缩为单列（`grid-template-columns: 1fr`）。
- `< 1100px`：宽网格（上传任务、仓库双栏）塌缩。
- 高 variance 布局必须在组件内显式声明移动端回退，不得依赖 Tailwind 默认。

## 7. 导航（AppShell）

- 侧栏品牌区有下分隔线（`border-bottom: 1px solid --gray-100`）。
- 导航项 `.nav a`：`--radius`，`--text-base`，默认 `--weight-medium`。
- 激活态：`--color-info-bg` 底 + `--color-primary` 文字 + 左侧 3px accent 竖条（`::before`）。
- 序号 chip：`--radius-sm` 圆角 + `--gray-100` 底 + `--font-mono` + `--text-xs`；激活时变为 `--color-primary` 底 + 白字。
- 底部 `.rail-status`：`--gray-50` 底 + `--radius`，显示任务状态。

## 8. 使用清单（新增页面前的 Pre-Flight）

- [ ] 所有字号、字重、行高使用令牌，无裸像素值
- [ ] 所有间距、圆角使用令牌
- [ ] 颜色使用语义令牌或 tone 令牌，无裸 hex
- [ ] 卡片/面板统一 `--radius` + `--shadow-card`
- [ ] 按钮使用既定样式类，主操作用 primary
- [ ] 表单 label 在 input 上方
- [ ] 声明 `< 760px` 移动端回退
- [ ] 数字、ID、日志用 `--font-mono`
- [ ] 交叉检查：同一页面内强调色不超出 primary + accent 两种

## 9. 令牌变更流程

设计令牌定义在 `src/app/globals.css` 的 `:root` 块。变更令牌时：

1. 修改 `:root` 中的令牌值。
2. 全站搜索该令牌确认影响范围。
3. 运行 `pnpm build:next` + `npx tsc --noEmit` 验证。
4. 同步更新本文档。
5. 不得为单个页面新增只在某处使用的私有令牌；新需求优先复用现有令牌。
