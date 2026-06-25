# Noon Multi-Store Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add local Noon store CRUD, one persistent login profile per store, store-scoped upload identity and status, and a usable store management UI.

**Architecture:** Keep repositories and stores independent. A focused store registry owns local store data and profile paths; product files keep store-independent identities; upload-time helpers append the selected store ID, enforce local uniqueness, and write status under that store. The existing Node HTTP server wires these services to REST endpoints and the existing single-file UI.

**Tech Stack:** Node.js ESM, `node:http`, `node:fs`, `node:test`, CloakBrowser, plain HTML/CSS/JavaScript.

## Global Constraints

- Add no runtime dependencies.
- Store IDs are immutable upper-case values matching `^[A-Z0-9]{2,12}$`.
- Store names are trimmed and contain 1 to 80 characters; project IDs match `^PRJ[0-9]+$`.
- Store configuration lives in `.noon-stores.json`; profiles live in `.noon-profiles/<storeId>/`.
- Repositories never store a store binding or preferred store.
- The base SKU keeps the `G-1001-...` prefix; the store ID is appended as a suffix.
- Barcodes are store-independent 12-digit internal partner barcodes and must not be described as registered GTINs.
- Existing product SKUs and barcodes are both replaced by the current deterministic rules before upload.
- The Add Product automation still uploads only the first variant; UI and status text must not claim full multi-variant upload.
- Never accept a browser profile path from an HTTP request and never log credentials, cookies, or tokens.
- Preserve unrelated dirty files and the untracked `exports/noon-bulk-updates/global/default/` directory.

## File Map

- Create `scripts/lib/noon-stores.js`: validation, registry persistence, URL/profile derivation, and deletion.
- Create `scripts/lib/noon-product-identity.js`: base SKU, store SKU, UPC-style check digit, and deterministic barcode generation.
- Create `scripts/lib/noon-upload-preflight.js`: product identity scoping, local conflict checks, and filesystem locks.
- Modify `scripts/lib/noon-upload-status.js`: version 2 store states only, without legacy compatibility.
- Modify `scripts/collect-1688.js`: generate collision-resistant variant SKUs and barcodes through the identity module.
- Modify `scripts/upload-noon.js`: require `storeId`, run preflight, derive identity, lock, and write store state.
- Modify `scripts/server.js`: store APIs, store login/status jobs, and server-derived upload arguments.
- Modify `public/index.html`: store management UI and upload store selector.
- Create focused tests under `tests/` for every new module and UI contract.

---

### Task 1: Local Store Registry

**Files:**
- Create: `scripts/lib/noon-stores.js`
- Test: `tests/noon-stores.test.js`

**Interfaces:**
- Produces: `validateNoonStore(input)`, `normalizeNoonStoreId(value)`, `readNoonStoreRegistry(rootDir)`, `writeNoonStoreRegistry(rootDir, registry)`, `addNoonStore(rootDir, input, options)`, `findNoonStore(rootDir, storeId)`, `deleteNoonStore(rootDir, storeId)`, `noonStoreProfileDir(rootDir, storeId)`, and `noonStoreUrl(store)`.
- Consumers: Tasks 2, 5, 6, and 7.

- [ ] **Step 1: Write failing registry tests**

```javascript
test("validates canonical store input", () => {
  assert.deepEqual(validateNoonStore({ id: "uae01", name: " Main UAE ", projectId: "PRJ517205" }), {
    id: "UAE01",
    name: "Main UAE",
    projectId: "PRJ517205",
  });
  assert.throws(() => validateNoonStore({ id: "../x", name: "X", projectId: "PRJ1" }), /店铺 ID/);
  assert.throws(() => validateNoonStore({ id: "UAE01", name: "", projectId: "PRJ1" }), /店铺名称/);
  assert.throws(() => validateNoonStore({ id: "UAE01", name: "X", projectId: "517205" }), /projectId/);
});

test("adds, finds, and rejects duplicate stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-"));
  const created = await addNoonStore(root, { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" }, {
    now: () => "2026-06-24T00:00:00.000Z",
  });
  assert.equal(created.createdAt, "2026-06-24T00:00:00.000Z");
  assert.equal((await findNoonStore(root, "uae01")).id, "UAE01");
  await assert.rejects(() => addNoonStore(root, created), /已存在/);
});

test("derives profile and URL without storing either", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-"));
  assert.equal(noonStoreProfileDir(root, "UAE01"), path.join(root, ".noon-profiles", "UAE01"));
  assert.equal(noonStoreUrl({ projectId: "PRJ517205" }), "https://noon-catalog.noon.partners/en/catalog/create?project=PRJ517205");
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `node --test tests/noon-stores.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND` for `scripts/lib/noon-stores.js`.

- [ ] **Step 3: Implement the registry**

Implement these exact rules in `scripts/lib/noon-stores.js`:

```javascript
export const noonStoresFileName = ".noon-stores.json";

export function normalizeNoonStoreId(value) {
  const id = String(value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{2,12}$/.test(id)) throw new Error("店铺 ID 必须是 2-12 位大写字母或数字。");
  return id;
}

export function validateNoonStore(input = {}) {
  const id = normalizeNoonStoreId(input.id);
  const name = String(input.name || "").trim();
  const projectId = String(input.projectId || "").trim().toUpperCase();
  if (name.length < 1 || name.length > 80) throw new Error("店铺名称必须是 1-80 个字符。");
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  return { id, name, projectId };
}

export function noonStoreProfileDir(rootDir, storeId) {
  return path.join(rootDir, ".noon-profiles", normalizeNoonStoreId(storeId));
}

export function noonStoreUrl(store) {
  const projectId = String(store?.projectId || "").trim().toUpperCase();
  if (!/^PRJ[0-9]+$/.test(projectId)) throw new Error("projectId 格式不合法。");
  return `https://noon-catalog.noon.partners/en/catalog/create?project=${encodeURIComponent(projectId)}`;
}
```

`readNoonStoreRegistry` returns `{ stores: [] }` for a missing file, rejects unreadable JSON, and validates every stored record. `writeNoonStoreRegistry` writes formatted JSON plus a trailing newline. `addNoonStore` rejects duplicate IDs and appends `createdAt`. `deleteNoonStore` removes the record, clears the profile with `rm(profileDir, { recursive: true, force: true })`, and returns the deleted record.

- [ ] **Step 4: Run registry tests**

Run: `node --test tests/noon-stores.test.js`

Expected: all registry tests PASS.

- [ ] **Step 5: Commit the registry**

```bash
git add scripts/lib/noon-stores.js tests/noon-stores.test.js
git commit -m "feat: add local noon store registry"
```

### Task 2: Store-Scoped Status Only

**Files:**
- Modify: `scripts/lib/noon-stores.js`
- Modify: `tests/noon-stores.test.js`
- Modify: `scripts/lib/noon-upload-status.js`
- Modify: `tests/noon-upload-status.test.js`
- Modify: `scripts/upload-noon.js` (replace removed status writer only)
- Modify: `scripts/server.js` (replace removed status reader only)
- Delete if present: `scripts/lib/noon-store-migration.js`
- Delete if present: `tests/noon-store-migration.test.js`

**Interfaces:**
- Consumes: Task 1 `normalizeNoonStoreId`.
- Produces: `readStoreNoonUploadStatusFromProductDir(productDir, relativeDir, storeId)` and `writeStoreNoonUploadStatus(productDir, status, storeId)`.
- Consumers: Tasks 4, 5, and 6.

- [ ] **Step 1: Write failing latest-model-only tests**

```javascript
test("store registry contains stores only", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-stores-latest-"));
  assert.deepEqual(await readNoonStoreRegistry(root), { stores: [] });
});

test("ignores legacy top-level upload status", async () => {
  const productDir = await makeProductDir();
  await writeFile(path.join(productDir, noonUploadStatusFileName), JSON.stringify({
    status: "uploaded",
    uploaded: true,
    partnerSku: "OLD-SKU",
  }));
  assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, "1688/default/1", "UAE01").status, "not_uploaded");
});

test("writes only version 2 store state", async () => {
  const productDir = await makeProductDir();
  await writeStoreNoonUploadStatus(productDir, { status: "uploading", partnerSku: "G-1001-1-V01-UAE01" }, "UAE01");
  const raw = JSON.parse(await readFile(path.join(productDir, noonUploadStatusFileName), "utf8"));
  assert.deepEqual(Object.keys(raw).sort(), ["stores", "version"]);
  assert.equal(raw.version, 2);
  assert.equal(raw.stores.UAE01.status, "uploading");
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `node --test tests/noon-stores.test.js tests/noon-upload-status.test.js`

Expected: FAIL because current code still exposes legacy migration/default fields.

- [ ] **Step 3: Remove compatibility branches**

`readNoonStoreRegistry` returns exactly `{ stores: [] }` when missing and writes no migration marker. Delete migration helpers and tests. `readStoreNoonUploadStatusFromProductDir` accepts only `version === 2` with a `stores` object; all older shapes return the default `not_uploaded` state. `writeStoreNoonUploadStatus` always overwrites with exactly `{ version: 2, stores }`, preserving existing v2 store entries but no unrelated legacy keys.

Replace existing static imports of removed top-level status APIs. `upload-noon.js` requires `--store-id` and writes with `writeStoreNoonUploadStatus`. `server.js` reads store status only when a store ID is supplied; otherwise it returns `defaultNoonUploadStatus(relativeDir)`. Do not add any legacy wrapper export.

Keep valid states `not_uploaded`, `uploading`, `uploaded`, and `failed`. Derive `uploaded` only from `status === "uploaded"`.

- [ ] **Step 4: Run focused and full tests**

Run: `node --test tests/noon-stores.test.js tests/noon-upload-status.test.js`

Expected: all focused tests PASS.

Run: `node --test`

Expected: all tests PASS.

Run: `node --check scripts/upload-noon.js && node --check scripts/server.js`

Expected: both entry points load without missing-export errors.

- [ ] **Step 5: Commit latest-only status model**

```bash
git add scripts/lib/noon-stores.js scripts/lib/noon-upload-status.js tests/noon-stores.test.js tests/noon-upload-status.test.js
git rm -f scripts/lib/noon-store-migration.js tests/noon-store-migration.test.js 2>/dev/null || true
git commit -m "refactor: keep latest noon store state only"
```

### Task 3: Deterministic Product Identity

**Files:**
- Create: `scripts/lib/noon-product-identity.js`
- Create: `tests/noon-product-identity.test.js`
- Modify: `scripts/collect-1688.js`

**Interfaces:**
- Consumes: Task 1 `normalizeNoonStoreId`.
- Produces: `buildBasePartnerSku({ productId, variantIndex, colourCode })`, `deriveStorePartnerSku(baseSku, storeId)`, `buildPartnerBarcode({ platform, productId, variantIndex, occupied })`, `regenerateProductIdentities(productsDir)`, and `upcCheckDigit(body)`.
- Consumers: Tasks 4 and 5.

- [ ] **Step 1: Write failing identity tests**

```javascript
test("builds unique descriptive variant SKUs", () => {
  assert.equal(buildBasePartnerSku({ productId: "123", variantIndex: 0, colourCode: "Black" }), "G-1001-123-V01-BLACK");
  assert.equal(buildBasePartnerSku({ productId: "123", variantIndex: 1, colourCode: "Black" }), "G-1001-123-V02-BLACK");
  assert.equal(deriveStorePartnerSku("G-1001-123-V01-BLACK", "uae01"), "G-1001-123-V01-BLACK-UAE01");
});

test("generates stable 12 digit store-independent barcodes", () => {
  const first = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 0, occupied: new Set() });
  const repeated = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 0, occupied: new Set() });
  const sibling = buildPartnerBarcode({ platform: "1688", productId: "123", variantIndex: 1, occupied: new Set([first]) });
  assert.match(first, /^[0-9]{12}$/);
  assert.equal(first, repeated);
  assert.notEqual(first, sibling);
  assert.equal(first.at(-1), upcCheckDigit(first.slice(0, 11)));
});

test("replaces every stored SKU and barcode with the current rules", async () => {
  const productsDir = await makeBarcodeProducts([
    { relativeDir: "1688/default/100", partnerSku: "OLD-100", barcode: "202604280001" },
    { relativeDir: "1688/default/200", partnerSku: "OLD-200", barcode: "202604280002" },
  ]);
  const result = await regenerateProductIdentities(productsDir);
  assert.deepEqual(result.changedProducts, ["1688/default/100", "1688/default/200"]);
  assert.equal(await readPartnerSku(productsDir, "1688/default/100"), "G-1001-100-V01-COLOUR");
  assert.match(await readBarcode(productsDir, "1688/default/200"), /^[0-9]{12}$/);
  assert.notEqual(await readBarcode(productsDir, "1688/default/100"), "202604280001");
  assert.deepEqual((await regenerateProductIdentities(productsDir)).changedProducts, []);
});
```

- [ ] **Step 2: Run identity tests and verify failure**

Run: `node --test tests/noon-product-identity.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement identity helpers**

Use `createHash("sha256")`, convert the digest to `BigInt`, take `% 100000000000n`, and pad to 11 digits. Compute the check digit as:

```javascript
export function upcCheckDigit(body) {
  if (!/^[0-9]{11}$/.test(body)) throw new Error("Barcode body must contain 11 digits.");
  const sum = [...body].reduce((total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 3 : 1), 0);
  return String((10 - (sum % 10)) % 10);
}
```

On collision, increment the 11-digit body modulo `100000000000n` and recompute the check digit until `occupied` does not contain the candidate. Normalize colour to upper-case ASCII letters, digits, and hyphens, capped at 12 characters; use `COLOUR` when empty.

`regenerateProductIdentities` reads all 1688 product directories, sorts them by `relativeDir` and variant index, and rebuilds every variant's `partner_sku`, `model_number`, and `barcode`. It derives the product ID from `meta.source.productId` with the directory name as fallback, derives colour from `colour_name` or `colour`, and calls `buildPartnerBarcode` with the current occupied set. It writes only product files whose values changed, uses a trailing newline, and returns `{ changedProducts, skippedProducts }`. Running it again without product changes returns an empty `changedProducts` array.

- [ ] **Step 4: Run identity tests**

Run: `node --test tests/noon-product-identity.test.js`

Expected: all identity tests PASS.

- [ ] **Step 5: Integrate identity generation into collection**

In `buildNoonProduct`, replace the shared `partnerSku`, colour-only suffix, and old `buildBarcode(productId, index)` with:

```javascript
const variantSku = buildBasePartnerSku({
  productId: meta.source.productId,
  variantIndex: index,
  colourCode: variantColour || sourceColour,
});
const barcode = buildPartnerBarcode({
  platform: "1688",
  productId: meta.source.productId,
  variantIndex: index,
  occupied: generatedBarcodes,
});
generatedBarcodes.add(barcode);
```

Assign `barcode` to the variant and delete the obsolete local `buildBarcode` and `skuColourCode` only when no callers remain.

- [ ] **Step 6: Run focused and full tests**

Run: `node --test tests/noon-product-identity.test.js tests/noon-bulk-update-exporter.test.js tests/noon-product-normalizer.test.js`

Expected: all tests PASS.

- [ ] **Step 7: Commit product identity**

```bash
git add scripts/lib/noon-product-identity.js scripts/collect-1688.js tests/noon-product-identity.test.js
git commit -m "fix: generate unique noon product identities"
```

### Task 4: Upload Preflight And Locking

**Files:**
- Create: `scripts/lib/noon-upload-preflight.js`
- Create: `tests/noon-upload-preflight.test.js`

**Interfaces:**
- Consumes: Task 1 store normalization, Task 2 store status reader, and Task 3 `deriveStorePartnerSku`.
- Produces: `scopeProductToStore(product, storeId)`, `assertStoreUploadAllowed({ productDir, relativeDir, storeId, product, productsDir })`, and `acquireStoreUploadLock(productDir, storeId, partnerSku)` returning `{ release() }`.
- Consumers: Task 5.

- [ ] **Step 1: Write failing scoping and lock tests**

```javascript
test("scopes first-variant upload identity without changing barcode", () => {
  const product = sampleNormalizedProduct();
  const scoped = scopeProductToStore(product, "UAE01");
  assert.equal(scoped.productIdentity.partnerSku, "G-1001-123-V01-BLACK-UAE01");
  assert.equal(scoped.offerDetails.offers[0].partnerSku, "G-1001-123-V01-BLACK-UAE01");
  assert.equal(scoped.offerDetails.offers[0].barcode, product.offerDetails.offers[0].barcode);
  assert.equal(product.productIdentity.partnerSku, "G-1001-123-V01-BLACK");
});

test("blocks uploaded and concurrent store uploads", async () => {
  const fixture = await makeUploadFixture();
  await writeStoreNoonUploadStatus(fixture.productDir, { status: "uploaded", partnerSku: fixture.partnerSku }, "UAE01");
  await assert.rejects(() => assertStoreUploadAllowed({ ...fixture, storeId: "UAE01" }), /已经上传/);
  await assert.doesNotReject(() => assertStoreUploadAllowed({ ...fixture, storeId: "SA01" }));
  const lock = await acquireStoreUploadLock(fixture.productDir, "SA01", `${fixture.partnerSku}-SA01`);
  await assert.rejects(() => acquireStoreUploadLock(fixture.productDir, "SA01", `${fixture.partnerSku}-SA01`), /正在上传/);
  await lock.release();
});
```

- [ ] **Step 2: Run preflight tests and verify failure**

Run: `node --test tests/noon-upload-preflight.test.js`

Expected: FAIL with `ERR_MODULE_NOT_FOUND`.

- [ ] **Step 3: Implement store scoping**

Use `structuredClone(product)`. Derive the selected first variant SKU once and update exactly:

```javascript
scoped.productIdentity.partnerSku = storeSku;
scoped.detailedContent.modelNumber = storeSku;
scoped.offerDetails.offers[0].partnerSku = storeSku;
```

Do not modify the barcode or source product file.

- [ ] **Step 4: Implement preflight and lock files**

`assertStoreUploadAllowed` rejects an existing `uploaded` or `uploading` state for the selected store and scans local `noon-product-attributes.json` files and store status files to report duplicate base/store SKUs and remaining duplicate barcodes with both relative product paths.

`acquireStoreUploadLock` creates `.noon-upload-lock-<STORE_ID>.json` with `open(path, "wx")`, writes `{ storeId, partnerSku, pid, createdAt }`, and returns an idempotent `release` that closes the handle and removes the file. An existing lock produces a conflict error and is never overwritten.

- [ ] **Step 5: Run preflight tests**

Run: `node --test tests/noon-upload-preflight.test.js`

Expected: all preflight tests PASS.

- [ ] **Step 6: Commit preflight**

```bash
git add scripts/lib/noon-upload-preflight.js tests/noon-upload-preflight.test.js
git commit -m "feat: guard store upload identity"
```

### Task 5: Integrate Store Identity Into Upload Automation

**Files:**
- Modify: `scripts/upload-noon.js`
- Create: `tests/noon-upload-product.test.js`
- Create: `scripts/lib/noon-upload-product.js`

**Interfaces:**
- Consumes: Task 2 status writers and Task 4 preflight helpers.
- Produces: `prepareNoonUploadProduct(rawProduct, productDir, storeId)` for testable normalization and scoping.
- Consumers: Task 6 server jobs.

- [ ] **Step 1: Extract and test upload product preparation**

Move current `normalizeProduct` behavior into `scripts/lib/noon-upload-product.js`, then scope its result:

```javascript
export async function prepareNoonUploadProduct(rawProduct, productDir, storeId) {
  const normalized = await normalizeNoonUploadProduct(rawProduct, productDir);
  return scopeProductToStore(normalized, storeId);
}
```

Test only the current `product_group + variants` input. Reject the old `productIdentity` shape. Assert only `variants[0]` is selected, its current base SKU receives the store suffix, and its regenerated barcode is unchanged by store scoping.

- [ ] **Step 2: Run upload product tests and verify failure**

Run: `node --test tests/noon-upload-product.test.js`

Expected: FAIL until the extracted module exists.

- [ ] **Step 3: Require store ID and add upload state transitions**

At process startup, require `--store-id`:

```javascript
const storeId = normalizeNoonStoreId(args.storeId ?? args["store-id"]);
```

For each product:

1. Run `regenerateProductIdentities(productsDir)` before reading the selected product, so every selected upload uses the current SKU and Barcode rules.
2. Load and prepare the store-scoped product.
3. Run `assertStoreUploadAllowed`.
4. Acquire the lock.
5. Write `uploading` with the derived SKU.
6. Run the existing page automation.
7. Write `uploaded` only after `submitOfferDetails` succeeds.
8. On error, write `failed` with `String(error.message)` and rethrow.
9. Release the lock in `finally`.

Use `writeStoreNoonUploadStatus`; remove the remaining top-level `writeNoonUploadStatus` call.

- [ ] **Step 4: Run focused upload tests and syntax check**

Run: `node --test tests/noon-upload-product.test.js tests/noon-upload-status.test.js tests/noon-upload-preflight.test.js`

Expected: all tests PASS.

Run: `node --check scripts/upload-noon.js`

Expected: exit code 0.

- [ ] **Step 5: Commit uploader integration**

```bash
git add scripts/upload-noon.js scripts/lib/noon-upload-product.js tests/noon-upload-product.test.js
git commit -m "feat: upload products with store identity"
```

### Task 6: Store APIs And Server-Derived Jobs

**Files:**
- Create: `scripts/lib/noon-store-api.js`
- Create: `scripts/lib/noon-store-jobs.js`
- Create: `tests/noon-store-api.test.js`
- Create: `tests/noon-store-jobs.test.js`
- Modify: `scripts/server.js`

**Interfaces:**
- Consumes: Tasks 1-2 latest-only store registry/status; Task 5 uploader `--store-id` contract.
- Produces: the five approved `/api/stores` endpoints and upload jobs that derive URL/profile from a stored store.
- Consumers: Task 7 UI.

- [ ] **Step 1: Write failing API service tests**

```javascript
test("store API lists, creates, and deletes stores", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "noon-store-api-"));
  assert.deepEqual((await handleNoonStoreApi({ method: "GET", pathname: "/api/stores", rootDir: root })).body.stores, []);
  const created = await handleNoonStoreApi({
    method: "POST",
    pathname: "/api/stores",
    body: { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" },
    rootDir: root,
    productsDir: path.join(root, "products"),
    now: fixedNow,
  });
  assert.equal(created.status, 201);
  assert.equal(created.body.store.id, "UAE01");
  const removed = await handleNoonStoreApi({ method: "DELETE", pathname: "/api/stores/UAE01", rootDir: root });
  assert.equal(removed.status, 200);
});

test("deleting the default store clears only the default selection", async () => {
  const root = await makeStoreRoot("UAE01");
  let defaultStoreId = "UAE01";
  await handleNoonStoreApi({
    method: "DELETE",
    pathname: "/api/stores/UAE01",
    rootDir: root,
    getDefaultStoreId: () => defaultStoreId,
    setDefaultStoreId: (value) => { defaultStoreId = value; },
  });
  assert.equal(defaultStoreId, "");
});
```

- [ ] **Step 2: Write failing job argument tests**

```javascript
test("builds profile-safe login, status, and upload arguments", () => {
  const store = { id: "UAE01", name: "Main UAE", projectId: "PRJ517205" };
  assert.deepEqual(buildNoonLoginArgs(rootDir, store), [
    "scripts/login-noon.js", "--noon-url", noonStoreUrl(store), "--profile", ".noon-profiles/UAE01",
  ]);
  assert.deepEqual(buildNoonStatusArgs(rootDir, store), [
    "scripts/check-noon-status.js", "--noon-url", noonStoreUrl(store), "--profile", ".noon-profiles/UAE01",
  ]);
  assert.deepEqual(buildNoonUploadIdentityArgs(rootDir, store), [
    "--noon-url", noonStoreUrl(store), "--profile", ".noon-profiles/UAE01", "--store-id", "UAE01",
  ]);
});
```

- [ ] **Step 3: Run API and job tests and verify failure**

Run: `node --test tests/noon-store-api.test.js tests/noon-store-jobs.test.js`

Expected: FAIL with missing modules.

- [ ] **Step 4: Implement API service and argument builders**

`handleNoonStoreApi` returns `{ handled, status, body }` and handles only:

- `GET /api/stores`
- `POST /api/stores`
- `DELETE /api/stores/:storeId`

On the first successful store creation, set `defaultStoreId` through an injected callback from `scripts/server.js`; do not read or move `.noon-profile`. Deleting the selected default calls `setDefaultStoreId("")` and never selects another store silently. Before creating a previously deleted ID, scan current v2 statuses and reject reuse when records still reference that ID.

Argument builders must use `path.relative(rootDir, noonStoreProfileDir(rootDir, store.id))` and never consume a request profile path.

- [ ] **Step 5: Wire server routes**

Add routing for:

```text
GET    /api/stores
POST   /api/stores
DELETE /api/stores/:storeId
POST   /api/stores/:storeId/login
GET    /api/stores/:storeId/status
```

Login spawns `scripts/login-noon.js`; status spawns `scripts/check-noon-status.js`. Both use stored store data. `POST /api/upload-jobs` requires `storeId`, rejects unknown stores, and derives `--noon-url`, `--profile`, and `--store-id`. Remove `storesJson` and `noonUrl` from `uiSettingKeys`; keep `defaultStoreId` in `uiSettingKeys` for programmatic persistence, but remove its manual text input from the UI.

Add `storeId` to upload job serialization and change `hasSuccessfulUploadedProducts` to read that store's status.

- [ ] **Step 6: Run server tests and checks**

Run: `node --test tests/noon-store-api.test.js tests/noon-store-jobs.test.js tests/noon-stores.test.js tests/noon-upload-status.test.js`

Expected: all tests PASS.

Run: `node --check scripts/server.js`

Expected: exit code 0.

- [ ] **Step 7: Commit server APIs**

```bash
git add scripts/server.js scripts/lib/noon-store-api.js scripts/lib/noon-store-jobs.js tests/noon-store-api.test.js tests/noon-store-jobs.test.js
git commit -m "feat: add noon store APIs"
```

### Task 7: Store Management UI

**Files:**
- Modify: `public/index.html`
- Create: `tests/noon-store-ui.test.js`

**Interfaces:**
- Consumes: Task 6 HTTP endpoints and `defaultStoreId` setting.
- Produces: store search, add, delete, login, status check, set-default, and upload selection UI.

- [ ] **Step 1: Write failing UI contract test**

```javascript
test("store management controls and API calls are present", async () => {
  const html = await readFile(new URL("../public/index.html", import.meta.url), "utf8");
  for (const id of ["storeSearch", "storeList", "addStoreButton", "storeDialog", "uploadStoreId"]) {
    assert.match(html, new RegExp(`id=["']${id}["']`));
  }
  assert.match(html, /fetchJson\("\/api\/stores"\)/);
  assert.match(html, /\/api\/stores\/.*\/login/);
  assert.match(html, /storeId:\s*uploadStoreId\.value/);
});
```

- [ ] **Step 2: Run UI contract test and verify failure**

Run: `node --test tests/noon-store-ui.test.js`

Expected: FAIL because the controls do not exist.

- [ ] **Step 3: Add Store Management markup and states**

Replace the manual Noon URL and default store text fields with:

- search input `#storeSearch`;
- store list `#storeList`;
- icon/text actions for Login, Check Status, Set Default, and Delete;
- Add Store dialog `#storeDialog` with `storeId`, `storeName`, and `storeProjectId` inputs;
- empty, loading, API error, live login, and delete-confirmation states.

Use the existing panel, dialog, button, and status styles. Do not add nested cards or a new dependency.

- [ ] **Step 4: Implement UI data flow**

Add functions with these signatures:

```javascript
async function loadStores()
function renderStores()
async function createStore(event)
async function deleteStore(storeId)
async function loginStore(storeId)
async function checkStoreStatus(storeId)
async function setDefaultStore(storeId)
function syncUploadStoreOptions()
```

`loadStores` calls `fetchJson("/api/stores")`. Search is local and case-insensitive over name and ID. Delete uses `window.confirm`. Setting the default persists `{ defaultStoreId }` through `/api/settings`. The first store returned becomes selected only when no saved default exists; do not silently change a valid saved default.

Call `loadStores()` after `restoreServerFormState()` completes and whenever the settings route becomes active. Do not poll store status automatically; check it only when the user clicks the status action.

Add `#uploadStoreId` above repository upload actions. `startUploadJob` must block when no store is selected and send:

```javascript
body: JSON.stringify({
  ...payload,
  storeId: uploadStoreId.value,
  noonBrowser: data.noonBrowser || "cloak",
  noonCloakTyping: form.elements.noonCloakTyping.checked,
  headless: data.noonHeadless === "true",
})
```

- [ ] **Step 5: Run UI and syntax tests**

Run: `node --test tests/noon-store-ui.test.js`

Expected: PASS.

Run: `node --check scripts/server.js`

Expected: exit code 0.

- [ ] **Step 6: Verify UI in the in-app browser**

Run: `PORT=4185 npm run ui`

Open `http://localhost:4185/#settings` and verify at desktop and mobile widths:

1. Empty state renders without overlap.
2. Add `UAE01 / Noon UAE Main / PRJ517205`.
3. Search finds it by `UAE01` and `UAE`.
4. Set it as default and confirm the upload selector updates.
5. Status check shows a precise logged-in, logged-out, or failed state.
6. Delete confirmation cancels cleanly; confirmed deletion removes the row and profile.

Expected: no console errors, clipped text, or overlapping controls.

- [ ] **Step 7: Commit the UI**

```bash
git add public/index.html tests/noon-store-ui.test.js
git commit -m "feat: add noon store management UI"
```

### Task 8: Full Regression And Acceptance

**Files:**
- Create: `tests/noon-multi-store-flow.test.js`
- Modify only files required to fix failures caused by Tasks 1-7.

**Interfaces:**
- Consumes: all previous tasks.
- Produces: verified multi-store feature with no known local uniqueness regressions.

- [ ] **Step 1: Write the cross-store integration test**

Create two stores and one normalized fixture product in a temporary root. Scope the product to `UAE01` and `SA01`, write `uploaded` for UAE and `failed` for SA, then assert:

```javascript
assert.equal(uae.productIdentity.partnerSku, `${baseSku}-UAE01`);
assert.equal(sa.productIdentity.partnerSku, `${baseSku}-SA01`);
assert.equal(uae.offerDetails.offers[0].barcode, sa.offerDetails.offers[0].barcode);
assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, relativeDir, "UAE01").status, "uploaded");
assert.equal(readStoreNoonUploadStatusFromProductDir(productDir, relativeDir, "SA01").status, "failed");
```

- [ ] **Step 2: Run the cross-store test**

Run: `node --test tests/noon-multi-store-flow.test.js`

Expected: PASS, proving store SKU and state isolation without contacting Noon.

- [ ] **Step 3: Run the full test suite**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 4: Run syntax checks for touched entry points**

Run: `node --check scripts/server.js`

Expected: exit code 0.

Run: `node --check scripts/collect-1688.js`

Expected: exit code 0.

Run: `node --check scripts/upload-noon.js`

Expected: exit code 0.

- [ ] **Step 5: Confirm latest-only data behavior**

Run: `node --test tests/noon-stores.test.js tests/noon-upload-status.test.js tests/noon-product-identity.test.js`

Expected: tests prove old profile/status data is not imported and existing SKU/Barcode values are regenerated with current rules.

- [ ] **Step 6: Review the final diff**

Run: `git status --short`

Expected: only planned source, test, spec, and plan files are changed; `exports/noon-bulk-updates/global/default/` remains unrelated and untracked.

Run: `git diff --check`

Expected: no whitespace errors.

- [ ] **Step 7: Commit final integration test and fixes**

```bash
git add scripts public tests/noon-multi-store-flow.test.js docs/superpowers/specs/2026-06-24-noon-multi-store-design.md docs/superpowers/plans/2026-06-24-noon-multi-store.md
git commit -m "test: verify noon multi-store workflow"
```
