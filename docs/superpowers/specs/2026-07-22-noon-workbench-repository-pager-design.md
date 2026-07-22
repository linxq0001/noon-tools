# Noon 工作台复用仓库分页 UI 设计

## 目标

将 Noon 工作台当前仅有“上一页 / 下一页”的分页条替换为与 `/repositories` 页面一致的分页 UI 和交互，同时保留已经完成的服务端分页、请求取消、加载禁用和批量操作安全保护。

## 设计来源

严格复用 `src/app/repositories/repositories-workspace.tsx` 与 `src/app/globals.css` 中现有分页先例：

- 左侧显示 `共 N 条`。
- 使用 `‹`、`›` 左右箭头。
- 最多展示 7 个页码项；页数较多时用 `•••` 省略。
- 当前页使用 `pager-page-button active`。
- 每页条数提供 `10 / 20 / 50 条/页`。
- 跳页输入支持失焦提交和 Enter 提交，输入被限制到 `1..totalPages`。
- 直接复用 `.pager`、`.pager-total`、`.pager-pages`、`.pager-page-button`、`.pager-arrow`、`.pager-ellipsis`、`.pager-jump` 与 `.pager-jump-input`，不新增近似视觉体系。

## Noon 页面行为

- 新增 `pageSize` 状态，初始值为 50，以保持当前 Noon 工作台默认加载量不变。
- 改变每页条数时回到第 1 页，并通过现有目录 API 请求新的 `pageSize`。
- 点击页码、左右箭头或提交跳页后，使用现有 AbortController 取消旧请求。
- 加载期间禁用页码、箭头、条数选择、跳页输入、商品选择和批量操作。
- 服务端返回钳制后的页码时继续回写客户端状态。
- 总数继续使用 `pagination.totalItems`，不会退回当前页行数。

## 页码算法

复用仓库页的规则：

- 总页数不超过 7：展示全部页码。
- 当前页在前 4 页：`1 2 3 4 5 ••• last`。
- 当前页在最后 4 页：`1 ••• last-4 last-3 last-2 last-1 last`。
- 中间区域：`1 ••• current-1 current current+1 ••• last`。

## 响应式与可访问性

- 使用现有 `.pager` 的 flex-wrap，在窄屏自然换行。
- 原生 `select` 和数字输入保留键盘操作。
- 当前页按钮使用现有 active 状态；加载态与边界页按钮使用 disabled。
- 跳页输入使用 `inputMode="numeric"`，Enter 与失焦均可提交。

## 验证

- 单元测试覆盖页码算法的少页、首页附近、中间页和末页附近。
- 源码契约测试确认 Noon 页面复用仓库分页 class、每页选项和跳页行为。
- TypeScript 检查通过。
- 浏览器验证第一页、直接页码、下一页、改变每页条数和跳页；确认 DOM 行数与选择值一致、控制台无错误。

## 不做事项

- 不修改目录同步和快照格式。
- 不修改 `/repositories` 的现有分页行为或视觉。
- 不新增依赖，不引入新的分页组件库。
- 不改变批量操作的“仅当前页选择”语义。
