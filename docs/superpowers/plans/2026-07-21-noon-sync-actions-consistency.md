# Noon 同步操作组一致性 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让 Noon 工作台顶部同步卡和空数据状态复用同一套紧凑、响应式同步按钮组。

**Architecture:** 在现有客户端组件文件内提取无状态 `CatalogSyncActions`，由两个页面位置传入相同状态和回调。CSS 用独立的操作组类控制按钮间距、对齐和移动端换行，不改变同步请求与任务逻辑。

**Tech Stack:** Next.js 15、React 19、TypeScript、CSS、Node.js test runner。

## Global Constraints

- 不改变同步 API、任务轮询、错误处理或快照读取逻辑。
- 两处入口必须共享按钮顺序、青色主按钮样式、禁用条件和 FBN/FBP 说明。
- 桌面端按钮横向紧邻；顶部靠右，空状态居中。
- 小于等于 760px 时不得横向溢出。
- 不新增依赖，不 commit、不 push。

---

### Task 1: 共享同步操作组

**Files:**
- Modify: `src/app/noon-workbench/noon-workbench-workspace.tsx`
- Test: `tests/next-shell.test.js`

**Interfaces:**
- Produces: `CatalogSyncActions({ catalogMode, disabled, exportDisabled, onStart })`。
- Consumes: `CatalogMode`、`CatalogSyncSource` 和现有 `startCatalogSync(source)`。

- [ ] **Step 1: 写失败契约测试**

在 `tests/next-shell.test.js` 断言只定义一个 `CatalogSyncActions`，且 JSX 使用两次；断言组件内按钮顺序为 API 后导出，并保留 `aria-describedby`：

```js
assert.equal(noonWorkbenchWorkspace.match(/<CatalogSyncActions/g)?.length, 2);
assert.equal(noonWorkbenchWorkspace.match(/function CatalogSyncActions\(/g)?.length, 1);
assert.match(noonWorkbenchWorkspace, /function CatalogSyncActions\([\s\S]*API 快速同步[\s\S]*导出同步/);
assert.match(noonWorkbenchWorkspace, /aria-describedby=\{catalogMode === "global" \? undefined : "catalog-export-mode-note"\}/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/next-shell.test.js`

Expected: FAIL，缺少 `CatalogSyncActions` 或仍存在两套按钮 JSX。

- [ ] **Step 3: 实现最小共享组件**

在同一文件中增加：

```tsx
function CatalogSyncActions({ catalogMode, disabled, exportDisabled, onStart }: {
  catalogMode: CatalogMode;
  disabled: boolean;
  exportDisabled: boolean;
  onStart: (source: CatalogSyncSource) => void;
}) {
  return (
    <div className="noon-sync-actions">
      <button disabled={disabled} onClick={() => onStart("internal_api")} type="button">API 快速同步</button>
      <button
        aria-describedby={catalogMode === "global" ? undefined : "catalog-export-mode-note"}
        disabled={exportDisabled}
        onClick={() => onStart("export")}
        title={catalogMode === "global" ? undefined : "导出同步仅支持 Global 模式"}
        type="button"
      >导出同步</button>
    </div>
  );
}
```

顶部和空状态分别渲染同一个组件；顶部保留状态文案和唯一的 `catalog-export-mode-note` 可见说明。

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/next-shell.test.js`

Expected: PASS，0 failures。

---

### Task 2: 统一桌面和移动端布局

**Files:**
- Modify: `src/app/globals.css`
- Test: `tests/next-shell.test.js`

**Interfaces:**
- Consumes: `.noon-sync-actions`。
- Produces: 顶部靠右、空状态居中、移动端可换行的统一按钮组。

- [ ] **Step 1: 写失败 CSS 契约测试**

```js
assert.match(css, /\.noon-sync-actions \{[\s\S]*display: flex;[\s\S]*gap: var\(--space-2\);/);
assert.match(css, /\.noon-empty-sync \.noon-sync-actions \{[\s\S]*justify-content: center;/);
assert.match(css, /@media \(max-width: 760px\)[\s\S]*\.noon-sync-actions \{[\s\S]*flex-wrap: wrap;/);
```

- [ ] **Step 2: 运行测试并确认失败**

Run: `node --test tests/next-shell.test.js`

Expected: FAIL，缺少 `.noon-sync-actions` 布局规则。

- [ ] **Step 3: 实现最小样式**

```css
.noon-sync-actions {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: var(--space-2);
  margin-left: auto;
}

.noon-empty-sync .noon-sync-actions {
  justify-content: center;
  margin-left: 0;
}

@media (max-width: 760px) {
  .noon-sync-actions {
    flex-wrap: wrap;
    justify-content: flex-start;
    margin-left: 0;
  }
}
```

- [ ] **Step 4: 运行测试并确认通过**

Run: `node --test tests/next-shell.test.js`

Expected: PASS，0 failures。

---

### Task 3: 回归与视觉验证

**Files:**
- No production file changes expected.

**Interfaces:**
- Verifies: 共享组件、响应式 CSS、类型和生产构建。

- [ ] **Step 1: 运行相关测试**

Run: `node --test --test-concurrency=1 tests/local-access.test.js tests/noon-catalog-internal-sync.test.js tests/noon-catalog-api-sync.test.js tests/noon-catalog-sync-source.test.js tests/next-shell.test.js`

Expected: PASS，0 failures。

- [ ] **Step 2: 运行类型检查和生产构建**

Run: `npx tsc --noEmit && npm run build:next`

Expected: exit 0。

- [ ] **Step 3: 视觉复核**

检查桌面端顶部按钮紧邻靠右、空状态按钮紧邻居中；检查 375px 视口无横向溢出，FBN/FBP 导出禁用说明可见。

- [ ] **Step 4: 检查目标差异**

Run: `git diff --check`

Expected: 本任务文件无新增 whitespace 错误；不修改任务范围外的既有告警。
