# Next.js Phase 1 Settings Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a small Next.js App Router shell and migrate only the settings read/write chain onto shared code.

**Architecture:** Keep the existing `scripts/server.js` and `public/index.html` working while adding `src/app` beside them. Extract `.ui-settings.json` handling into `src/lib/settings.ts`, expose it through `src/app/api/settings/route.ts`, and build a restrained settings page that talks to that API.

**Tech Stack:** Next.js App Router, React, TypeScript, Node.js filesystem APIs, existing `node:test`, local file storage under `.ui-settings.json`.

## Global Constraints

- Do not delete or replace `public/index.html`.
- Do not delete or replace `scripts/server.js`.
- Keep `npm run ui` as the existing legacy UI entry.
- Add Next scripts as separate entries: `dev:next`, `build:next`, `start:next`.
- Do not introduce Prisma, PostgreSQL, Auth.js, TanStack Query, Zustand, or a task queue.
- Preserve `.ui-settings.json` as the settings storage file.
- Preserve `products/`, `exports/`, `.noon-stores.json`, and all existing business scripts.
- Stage one migrates only settings; collection, upload, repositories, stores, and Noon sync remain on the existing UI/API.

---

## File Structure

- Create `src/lib/settings.ts`
  - Owns settings key whitelist, project root resolution, `.ui-settings.json` path, reading, sanitizing, and merged writes.

- Create `tests/next-settings.test.js`
  - Tests the shared settings module with a temporary root directory.

- Create `tests/next-shell.test.js`
  - Static contract test for package scripts and Next settings files.

- Modify `package.json`
  - Add Next dependencies and separate Next scripts without changing `ui`.

- Create `tsconfig.json`
  - Minimal strict TypeScript config for Next.

- Create `next.config.mjs`
  - Minimal Next config.

- Create `src/app/layout.tsx`
  - Shared shell HTML and global stylesheet import.

- Create `src/app/page.tsx`
  - Minimal dashboard-style index with links to migrated and legacy areas.

- Create `src/app/settings/page.tsx`
  - Server page wrapper for the settings form.

- Create `src/app/settings/settings-form.tsx`
  - Client form that loads and saves `/api/settings`.

- Create `src/app/api/settings/route.ts`
  - Next Route Handler for `GET` and `POST`.

- Create `src/app/globals.css`
  - Small, restrained internal-tool styling.

---

### Task 1: Shared Settings Contract

**Files:**
- Create: `src/lib/settings.ts`
- Create: `tests/next-settings.test.js`

**Interfaces:**
- Produces:
  - `export const UI_SETTING_KEYS: readonly string[]`
  - `export type UiSettings = Partial<Record<(typeof UI_SETTING_KEYS)[number] | "updatedAt", string>>`
  - `export function sanitizeUiSettings(values: unknown): UiSettings`
  - `export function settingsPath(rootDir?: string): string`
  - `export async function readUiSettings(rootDir?: string): Promise<UiSettings>`
  - `export async function saveUiSettings(values: unknown, rootDir?: string): Promise<UiSettings>`

- [ ] **Step 1: Write failing settings tests**

Create `tests/next-settings.test.js`:

```js
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("readUiSettings returns empty object when settings file is missing", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { readUiSettings } = await import("../src/lib/settings.ts");

  assert.deepEqual(await readUiSettings(rootDir), {});

  await rm(rootDir, { recursive: true, force: true });
});

test("saveUiSettings keeps only known string settings and writes updatedAt", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { saveUiSettings } = await import("../src/lib/settings.ts");

  const saved = await saveUiSettings({ url: "https://detail.1688.com", limit: 5, unknown: "drop" }, rootDir);
  const raw = JSON.parse(await readFile(path.join(rootDir, ".ui-settings.json"), "utf8"));

  assert.equal(saved.url, "https://detail.1688.com");
  assert.equal(saved.limit, "5");
  assert.equal(saved.unknown, undefined);
  assert.match(saved.updatedAt, /^\d{4}-\d{2}-\d{2}T/);
  assert.deepEqual(raw, saved);

  await rm(rootDir, { recursive: true, force: true });
});

test("saveUiSettings merges with existing settings", async () => {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "noon-settings-"));
  const { saveUiSettings } = await import("../src/lib/settings.ts");

  await saveUiSettings({ url: "https://old.example", limit: "10" }, rootDir);
  const saved = await saveUiSettings({ limit: "20" }, rootDir);

  assert.equal(saved.url, "https://old.example");
  assert.equal(saved.limit, "20");

  await rm(rootDir, { recursive: true, force: true });
});
```

- [ ] **Step 2: Verify tests fail before implementation**

Run:

```bash
node --test tests/next-settings.test.js
```

Expected: FAIL because `src/lib/settings.ts` does not exist yet.

- [ ] **Step 3: Add the shared settings module**

Create `src/lib/settings.ts`:

```ts
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const UI_SETTING_KEYS = [
  "url",
  "limit",
  "headless",
  "storageState",
  "deepseekApiKey",
  "deepseekModel",
  "ocrLanguage",
  "ocrProvider",
  "uploadProductDir",
  "uploadHeadless",
  "uploadStorageState",
  "uploadStoreId",
  "defaultStoreId",
] as const;

export type UiSettings = Partial<Record<(typeof UI_SETTING_KEYS)[number] | "updatedAt", string>>;

export function projectRoot() {
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

export function settingsPath(rootDir = projectRoot()) {
  return path.join(rootDir, ".ui-settings.json");
}

export function sanitizeUiSettings(values: unknown): UiSettings {
  const source = values && typeof values === "object" ? values as Record<string, unknown> : {};
  const settings: UiSettings = {};

  for (const key of UI_SETTING_KEYS) {
    if (source[key] !== undefined) settings[key] = String(source[key]);
  }

  return settings;
}

export async function readUiSettings(rootDir = projectRoot()): Promise<UiSettings> {
  try {
    return sanitizeUiSettings(JSON.parse(await readFile(settingsPath(rootDir), "utf8")));
  } catch {
    return {};
  }
}

export async function saveUiSettings(values: unknown, rootDir = projectRoot()): Promise<UiSettings> {
  const next: UiSettings = {
    ...await readUiSettings(rootDir),
    ...sanitizeUiSettings(values),
    updatedAt: new Date().toISOString(),
  };

  await writeFile(settingsPath(rootDir), `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}
```

- [ ] **Step 4: Verify shared settings tests pass**

Run:

```bash
node --test tests/next-settings.test.js
```

Expected: PASS.

---

### Task 2: Next Shell Files and Scripts

**Files:**
- Create: `tests/next-shell.test.js`
- Modify: `package.json`
- Create: `tsconfig.json`
- Create: `next.config.mjs`
- Create: `src/app/layout.tsx`
- Create: `src/app/page.tsx`
- Create: `src/app/globals.css`

**Interfaces:**
- Consumes: `src/lib/settings.ts` from Task 1 in later tasks.
- Produces: Next app shell and npm scripts.

- [ ] **Step 1: Write failing shell contract tests**

Create `tests/next-shell.test.js`:

```js
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("package keeps legacy ui and adds separate next scripts", async () => {
  const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));

  assert.equal(pkg.scripts.ui, "node scripts/server.js");
  assert.equal(pkg.scripts["dev:next"], "next dev");
  assert.equal(pkg.scripts["build:next"], "next build");
  assert.equal(pkg.scripts["start:next"], "next start");
  assert.ok(pkg.dependencies.next);
  assert.ok(pkg.dependencies.react);
  assert.ok(pkg.dependencies["react-dom"]);
});

test("next app shell files exist", async () => {
  const layout = await readFile(new URL("../src/app/layout.tsx", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const css = await readFile(new URL("../src/app/globals.css", import.meta.url), "utf8");

  assert.match(layout, /import "\.\/globals\.css"/);
  assert.match(page, /Next 迁移工作台/);
  assert.match(page, /href="\/settings"/);
  assert.match(css, /--font-ui/);
});
```

- [ ] **Step 2: Verify shell tests fail before implementation**

Run:

```bash
node --test tests/next-shell.test.js
```

Expected: FAIL because Next scripts and `src/app` files do not exist yet.

- [ ] **Step 3: Add dependencies and scripts**

Update `package.json` so the `scripts` block keeps `ui` and adds:

```json
"dev:next": "next dev",
"build:next": "next build",
"start:next": "next start"
```

Add dependencies:

```json
"next": "^15.3.0",
"react": "^19.0.0",
"react-dom": "^19.0.0",
"typescript": "^5.8.0",
"@types/node": "^22.0.0",
"@types/react": "^19.0.0",
"@types/react-dom": "^19.0.0"
```

- [ ] **Step 4: Add minimal Next config and app shell**

Create `tsconfig.json`, `next.config.mjs`, `src/app/layout.tsx`, `src/app/page.tsx`, and `src/app/globals.css` with minimal strict config and restrained internal-tool styling.

- [ ] **Step 5: Install dependencies and verify shell tests pass**

Run:

```bash
npm install
node --test tests/next-shell.test.js
```

Expected: PASS.

---

### Task 3: Next Settings API and Page

**Files:**
- Create: `src/app/api/settings/route.ts`
- Create: `src/app/settings/page.tsx`
- Create: `src/app/settings/settings-form.tsx`
- Modify: `tests/next-shell.test.js`

**Interfaces:**
- Consumes:
  - `readUiSettings(rootDir?: string): Promise<UiSettings>`
  - `saveUiSettings(values: unknown, rootDir?: string): Promise<UiSettings>`
- Produces:
  - `GET /api/settings`
  - `POST /api/settings`
  - Browser settings form.

- [ ] **Step 1: Add failing static tests for settings route and page**

Append to `tests/next-shell.test.js`:

```js
test("next settings route and page use shared settings module", async () => {
  const route = await readFile(new URL("../src/app/api/settings/route.ts", import.meta.url), "utf8");
  const page = await readFile(new URL("../src/app/settings/page.tsx", import.meta.url), "utf8");
  const form = await readFile(new URL("../src/app/settings/settings-form.tsx", import.meta.url), "utf8");

  assert.match(route, /readUiSettings/);
  assert.match(route, /saveUiSettings/);
  assert.match(route, /export async function GET/);
  assert.match(route, /export async function POST/);
  assert.match(page, /SettingsForm/);
  assert.match(form, /"use client"/);
  assert.match(form, /fetch\("\/api\/settings"\)/);
  assert.match(form, /method: "POST"/);
});
```

- [ ] **Step 2: Verify route/page tests fail before implementation**

Run:

```bash
node --test tests/next-shell.test.js
```

Expected: FAIL because the settings route and page files do not exist.

- [ ] **Step 3: Add settings route**

Create `src/app/api/settings/route.ts`:

```ts
import { NextResponse } from "next/server";
import { readUiSettings, saveUiSettings } from "@/lib/settings";

export const runtime = "nodejs";

export async function GET() {
  return NextResponse.json(await readUiSettings());
}

export async function POST(request: Request) {
  try {
    return NextResponse.json(await saveUiSettings(await request.json()));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "保存设置失败。" }, { status: 500 });
  }
}
```

- [ ] **Step 4: Add settings page and form**

Create `src/app/settings/page.tsx`:

```tsx
import SettingsForm from "./settings-form";

export default function SettingsPage() {
  return (
    <main className="page-shell">
      <div className="page-heading">
        <p>Settings</p>
        <h1>配置</h1>
      </div>
      <SettingsForm />
    </main>
  );
}
```

Create `src/app/settings/settings-form.tsx` with a client component that fetches `/api/settings`, renders the listed settings fields, and posts the edited values back to `/api/settings`.

- [ ] **Step 5: Verify route/page tests pass**

Run:

```bash
node --test tests/next-shell.test.js
```

Expected: PASS.

---

### Task 4: Full Verification

**Files:**
- No new files.

**Interfaces:**
- Consumes all prior tasks.
- Produces verified phase-one baseline.

- [ ] **Step 1: Run focused tests**

Run:

```bash
node --test tests/next-settings.test.js tests/next-shell.test.js
```

Expected: PASS.

- [ ] **Step 2: Run repository test suite**

Run:

```bash
npm test
```

Expected: PASS, or report pre-existing unrelated failures with exact failing test names.

- [ ] **Step 3: Build Next app**

Run:

```bash
npm run build:next
```

Expected: PASS.

- [ ] **Step 4: Optional local smoke check**

Run:

```bash
npm run dev:next -- --port 4175
```

Open `http://localhost:4175/settings`, edit one harmless field, save, and confirm `.ui-settings.json` updates.

Stop the dev server after the check.

---

## Self-Review

- Spec coverage: The plan creates a separate Next shell, preserves the legacy UI, migrates only settings, and keeps file storage.
- Placeholder scan: No task relies on unspecified dependencies or hidden files.
- Type consistency: The route imports the same `readUiSettings` and `saveUiSettings` functions defined in Task 1.
