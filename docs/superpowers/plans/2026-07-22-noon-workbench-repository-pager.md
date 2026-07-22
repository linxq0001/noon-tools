# Noon Workbench Repository Pager Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make Noon Workbench use the exact same reusable pagination UI and interaction contract as the repositories page.

**Architecture:** Extract the existing repository pager markup and page-window algorithm into one shared client component. Keep page ownership and data fetching in each workspace; the shared pager only renders controls and emits page/page-size changes. Noon retains its AbortController, loading guards, server pagination, and current-page-only selection semantics.

**Tech Stack:** Next.js 15, React 19, TypeScript, existing global CSS tokens, Node test runner.

## Global Constraints

- Reuse the existing `.pager*` classes from `src/app/globals.css`; do not add a second pagination visual system.
- Page-size choices are exactly `10`, `20`, and `50`.
- Noon keeps its current default page size of `50`.
- Loading disables page navigation, page-size selection, and page-jump input.
- No new dependency, database change, snapshot-format change, commit, push, or deployment.

---

### Task 1: Extract the repository pager into a shared component

**Files:**
- Create: `src/components/workbench/pager.tsx`
- Create: `tests/workbench-pager.test.js`
- Modify: `src/app/repositories/repositories-workspace.tsx`

**Interfaces:**
- Produces: `Pager({ page, pageSize, totalItems, totalPages, disabled?, onPageChange, onPageSizeChange })`.
- Produces: `buildPagerItems(currentPage, totalPages): Array<number | "ellipsis">` for deterministic tests.
- Consumes: existing `.pager`, `.pager-total`, `.pager-pages`, `.pager-page-button`, `.pager-arrow`, `.pager-ellipsis`, `.pager-jump`, and `.pager-jump-input` styles.

- [ ] **Step 1: Write failing page-window and component-contract tests**

Create `tests/workbench-pager.test.js`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { buildPagerItems } from "../src/components/workbench/pager.tsx";

test("buildPagerItems matches repository pagination windows", () => {
  assert.deepEqual(buildPagerItems(1, 4), [1, 2, 3, 4]);
  assert.deepEqual(buildPagerItems(1, 20), [1, 2, 3, 4, 5, "ellipsis", 20]);
  assert.deepEqual(buildPagerItems(10, 20), [1, "ellipsis", 9, 10, 11, "ellipsis", 20]);
  assert.deepEqual(buildPagerItems(20, 20), [1, "ellipsis", 16, 17, 18, 19, 20]);
});

test("shared Pager exposes repository controls and loading guards", async () => {
  const source = await readFile(new URL("../src/components/workbench/pager.tsx", import.meta.url), "utf8");
  assert.match(source, /共 \{totalItems\} 条/);
  assert.match(source, /\[10, 20, 50\]/);
  assert.match(source, /inputMode="numeric"/);
  assert.match(source, /event\.key === "Enter"/);
  assert.match(source, /disabled=\{disabled/);
});
```

- [ ] **Step 2: Run tests and confirm the red state**

Run:

```bash
node --test --test-isolation=none tests/workbench-pager.test.js
```

Expected: FAIL because `src/components/workbench/pager.tsx` does not exist.

- [ ] **Step 3: Implement the shared pager**

Create `src/components/workbench/pager.tsx` with a client component that:

```tsx
"use client";

import { useState } from "react";

type PagerProps = {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
  disabled?: boolean;
  onPageChange: (page: number) => void;
  onPageSizeChange: (pageSize: number) => void;
};

export function buildPagerItems(currentPage: number, totalPages: number): Array<number | "ellipsis"> {
  if (totalPages <= 7) return Array.from({ length: totalPages }, (_, index) => index + 1);
  if (currentPage <= 4) return [1, 2, 3, 4, 5, "ellipsis", totalPages];
  if (currentPage >= totalPages - 3) return [1, "ellipsis", totalPages - 4, totalPages - 3, totalPages - 2, totalPages - 1, totalPages];
  return [1, "ellipsis", currentPage - 1, currentPage, currentPage + 1, "ellipsis", totalPages];
}

export function Pager({ page, pageSize, totalItems, totalPages, disabled = false, onPageChange, onPageSizeChange }: PagerProps) {
  const [pageJump, setPageJump] = useState("");
  const pagerItems = buildPagerItems(page, totalPages);
  const submitPageJump = () => {
    if (!pageJump.trim()) return;
    const nextPage = Number(pageJump);
    if (!Number.isInteger(nextPage)) return;
    onPageChange(Math.min(totalPages, Math.max(1, nextPage)));
    setPageJump("");
  };

  return (
    <div className="pager">
      <span className="pager-total">共 {totalItems} 条</span>
      <button className="pager-arrow" disabled={disabled || page <= 1} onClick={() => onPageChange(page - 1)} type="button">‹</button>
      <div className="pager-pages">
        {pagerItems.map((item, index) => item === "ellipsis" ? (
          <span className="pager-ellipsis" key={`ellipsis-${index}`}>•••</span>
        ) : (
          <button className={item === page ? "pager-page-button active" : "pager-page-button"} disabled={disabled} key={item} onClick={() => onPageChange(item)} type="button">{item}</button>
        ))}
      </div>
      <button className="pager-arrow" disabled={disabled || page >= totalPages} onClick={() => onPageChange(page + 1)} type="button">›</button>
      <select data-page-size disabled={disabled} value={pageSize} onChange={(event) => onPageSizeChange(Number(event.target.value))}>
        {[10, 20, 50].map((size) => <option key={size} value={size}>{size} 条/页</option>)}
      </select>
      <label className="pager-jump">跳至<input className="pager-jump-input" disabled={disabled} inputMode="numeric" value={pageJump} onBlur={submitPageJump} onChange={(event) => setPageJump(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") submitPageJump(); }} />页</label>
    </div>
  );
}
```

- [ ] **Step 4: Replace repository-local pager markup and helper**

In `src/app/repositories/repositories-workspace.tsx`:

- Import `Pager` from `@/components/workbench/pager`.
- Remove the local `pageJump` state, `pagerItems`, `submitPageJump`, pager JSX, and `buildPagerItems` helper.
- Render:

```tsx
{pagination ? (
  <Pager
    onPageChange={setPage}
    onPageSizeChange={(nextPageSize) => { setPageSize(nextPageSize); setPage(1); }}
    page={pagination.page}
    pageSize={pageSize}
    totalItems={pagination.totalItems}
    totalPages={pagination.totalPages}
  />
) : null}
```

- [ ] **Step 5: Run shared and repository tests**

Run:

```bash
node --test --test-isolation=none tests/workbench-pager.test.js tests/next-shell.test.js
```

Expected: all tests PASS; update only static assertions that intentionally reference the old inline repository markup.

---

### Task 2: Adopt the shared pager in Noon Workbench

**Files:**
- Modify: `src/app/noon-workbench/noon-workbench-workspace.tsx`
- Modify: `src/app/noon-workbench/noon-workbench.css`
- Modify: `tests/noon-workbench-pagination.test.js`
- Modify: `TASK-STATE.md`

**Interfaces:**
- Consumes: `Pager` from Task 1.
- Preserves: `/api/noon-catalog-sync?page=<page>&pageSize=<pageSize>` and AbortController request cancellation.

- [ ] **Step 1: Update the Noon pagination contract test first**

Replace the old previous/next assertions in `tests/noon-workbench-pagination.test.js` with:

```js
assert.match(source, /import \{ Pager \} from "@\/components\/workbench\/pager"/);
assert.match(source, /const \[catalogPageSize, setCatalogPageSize\] = useState\(50\)/);
assert.match(source, /pageSize: String\(catalogPageSize\)/);
assert.match(source, /<Pager/);
assert.match(source, /disabled=\{catalogLoading\}/);
assert.match(source, /onPageSizeChange=\{\(pageSize\) => \{ setCatalogPageSize\(pageSize\); setCatalogPage\(1\); \}\}/);
```

- [ ] **Step 2: Run the Noon contract test and confirm red**

Run:

```bash
node --test --test-isolation=none tests/noon-workbench-pagination.test.js
```

Expected: FAIL because Noon still renders `.noon-catalog-pagination` and hard-codes `pageSize: "50"`.

- [ ] **Step 3: Replace the Noon pager**

In `src/app/noon-workbench/noon-workbench-workspace.tsx`:

- Import `Pager`.
- Add `const [catalogPageSize, setCatalogPageSize] = useState(50);`.
- Send `pageSize: String(catalogPageSize)` in `refreshCatalogRows`.
- Replace `.noon-catalog-pagination` with:

```tsx
{catalogPagination.totalItems > 0 ? (
  <Pager
    disabled={catalogLoading}
    onPageChange={setCatalogPage}
    onPageSizeChange={(pageSize) => { setCatalogPageSize(pageSize); setCatalogPage(1); }}
    page={catalogPagination.page}
    pageSize={catalogPageSize}
    totalItems={catalogPagination.totalItems}
    totalPages={catalogPagination.totalPages}
  />
) : null}
```

- Include `catalogPageSize` in the data-loading effect so a page-size change at page 1 still fetches immediately.
- Keep request cancellation, selection clearing, server-page correction, and loading guards unchanged.

- [ ] **Step 4: Remove obsolete Noon-only pager CSS**

Delete `.noon-catalog-pagination` rules and its mobile override from `src/app/noon-workbench/noon-workbench.css`. Do not modify the shared `.pager*` styles.

- [ ] **Step 5: Run affected tests and typecheck**

Run:

```bash
node --test --test-isolation=none tests/workbench-pager.test.js tests/noon-workbench-pagination.test.js tests/noon-catalog-sync-reader.test.js tests/next-shell.test.js tests/noon-workbench-bulk-actions.test.js tests/local-access.test.js
npx tsc --noEmit
```

Expected: all tests PASS and TypeScript exits 0.

- [ ] **Step 6: Verify the real page in the browser**

Open `http://127.0.0.1:3000/noon-workbench` and verify:

- The pager visually matches `/repositories`.
- First-page controls show total `109337` and active page `1`.
- Click page `2`; exactly 50 product articles render.
- Select `20 条/页`; page resets to 1 and exactly 20 product articles render.
- Enter `8` in jump input and press Enter; active page becomes 8.
- Browser console has no errors.

- [ ] **Step 7: Update task state and perform read-only review**

Record test, API, and browser evidence in `TASK-STATE.md`. Run a read-only fullstack/visual review; fix any BLOCKER/HIGH issues and re-run affected evidence. Do not commit or push without separate user authorization.
