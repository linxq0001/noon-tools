# Noon Multi-Store Design

## Status

Approved in conversation on 2026-06-24.

## Goal

Add local Noon store management so one noon-tools installation can:

- add, list, search, and delete stores;
- keep one persistent local Noon login profile per store;
- run uploads in the background with the selected store profile;
- upload one repository product to multiple stores without `partner_sku` conflicts;
- keep upload state isolated by store.

## Non-Goals

- Binding a repository permanently to a store.
- Moving or copying products between repositories.
- Storing Noon passwords, tokens, or cookies outside the browser profile.
- Synchronizing store configuration to a remote service.
- Editing a store after creation. Incorrect stores are deleted and recreated.
- Querying Noon remotely for existing SKUs. The current integration has no catalog query API.

## Current Constraints

The existing implementation needs correction before it is multi-store safe:

- Product generation uses `G-1001-<1688 product id>` and an optional truncated colour suffix.
- The colour suffix can collide after normalization or truncation.
- Barcode generation uses a fixed date plus variant index, so different products can receive the same barcode.
- The upload adapter normalizes only `variants[0]` into the Add Product flow.
- `noon-upload-status.json` stores one global upload result per product.
- Bulk export expects the existing `G-1001-...` catalog and platform prefix format.

## Architecture

Stores and repositories remain independent.

- A repository owns source products and their stable base identities.
- A store owns a Noon project identity and a persistent browser profile.
- The upload action selects a store; the global default store is only a convenience.
- The server resolves the store profile, Noon URL, derived SKU, and store-specific upload status.
- A product can be uploaded to any number of stores without copying its files.

There is no repository-level `preferredStoreId`. This avoids hidden bindings and keeps store selection explicit at the upload boundary.

## Store Storage

Store configuration is saved in `.noon-stores.json`:

```json
{
  "stores": [
    {
      "id": "UAE01",
      "name": "Noon UAE Main",
      "projectId": "PRJ517205",
      "createdAt": "2026-06-24T00:00:00.000Z"
    }
  ]
}
```

Rules:

- `id` is immutable, unique, upper-case, and matches `^[A-Z0-9]{2,12}$` so it is safe for use as an SKU suffix.
- `name` is a user-facing label and does not participate in identity.
- `name` is trimmed and contains 1 to 80 characters.
- `projectId` matches `^PRJ[0-9]+$` and is used to derive the Noon create-product URL.
- Browser profiles are derived as `.noon-profiles/<storeId>/`; `profileDir` is not stored.
- Login status is checked live and is not persisted because it becomes stale.
- `defaultStoreId` remains in `.ui-settings.json`.

Deleting a store removes its configuration and local browser profile after confirmation. Historical product upload records remain available for audit and duplicate detection.

## Product And Upload Identity

Product files store a store-independent base SKU. New products use:

```text
G-1001-<productId>-V<variantIndex>-<colourCode>
```

Example:

```text
G-1001-123456789-V01-BLACK
```

The variant index is part of the identity so normalized or truncated colour names cannot create sibling collisions. The colour code remains descriptive but is not relied on for uniqueness.

At upload time, the selected store ID is appended:

```text
<basePartnerSku>-<storeId>
```

Example:

```text
G-1001-123456789-V01-BLACK-UAE01
```

The store ID is a suffix, not a prefix, so existing `G-1001-...` bulk export parsing remains valid. The derived SKU is not written back into `noon-product-attributes.json`.

Before upload, all local variants are rewritten to the current base SKU rule. Existing SKU values are not preserved. The store suffix remains an upload-time value and is not written back into `noon-product-attributes.json`.

## Barcode Rule

Barcode is independent of store identity and remains the same when a variant is uploaded to multiple stores. It retains the current 12-digit numeric shape used by the upload flow.

The generator changes from a fixed date plus index to a deterministic function of:

```text
platform + source product id + variant index
```

Generation interprets the SHA-256 digest as an unsigned integer, takes it modulo `100000000000`, and zero-pads the result to form an 11-digit body. The twelfth digit is a standard UPC check digit. If the candidate already belongs to another local variant, the body is incremented modulo `100000000000` until an unused candidate is found, recomputing the check digit each time. The chosen value is persisted in the product file, so later filesystem order cannot change it.

The implementation must satisfy these contracts:

- equal inputs produce the same barcode;
- different local product variants produce different barcodes;
- generated values contain exactly 12 numeric digits, matching the existing upload field shape;
- generated values are checked against all local products before upload;
- existing barcodes are replaced by the new deterministic rule before the next upload.

Before upload, all local variants are sorted by `platform/productId/variantIndex` and regenerated with the new rule. Existing barcode values do not participate in identity and are not preserved. Generated values are internal partner barcodes and must not be represented as registered GTIN allocations.

## Upload Status

`noon-upload-status.json` becomes store-scoped:

```json
{
  "version": 2,
  "stores": {
    "UAE01": {
      "status": "uploaded",
      "partnerSku": "G-1001-123456789-V01-BLACK-UAE01",
      "uploadedAt": "2026-06-24T00:00:00.000Z",
      "message": "Upload completed"
    }
  }
}
```

Valid states are `not_uploaded`, `uploading`, `uploaded`, and `failed`.

- `uploading` is written only after all preflight checks pass.
- `uploaded` is written only after Noon submission succeeds.
- Failures write `failed` with a sanitized message.
- A successful record blocks another upload of the same product to the same store.
- Store records are independent; one store's result never changes another store's state.

The current Add Product adapter uploads only the first variant. Multi-store support must not imply that all variants were uploaded. Full multi-variant submission is a separate feature; status and UI copy must accurately describe the uploaded variant until that feature exists.

## Development Data Policy

This project is still under development and does not preserve legacy local data:

- `.noon-profile` is not migrated; every store logs in with `.noon-profiles/<storeId>/`.
- Top-level legacy upload status is ignored and replaced by version 2 store-scoped status on the next write.
- Existing base SKUs and barcodes are regenerated with the current rules before the next upload.
- No migration marker or compatibility branch is stored.

## Server Components And APIs

A focused store module owns validation, persistence, URL derivation, profile paths, and deletion. Route handlers call this module instead of manipulating JSON directly.

Required endpoints:

```text
GET    /api/stores
POST   /api/stores
DELETE /api/stores/:storeId
POST   /api/stores/:storeId/login
GET    /api/stores/:storeId/status
```

The existing upload endpoint adds required `storeId` input. The server rejects unknown stores and never accepts a caller-provided profile path.

Store input is validated before filesystem access. IDs must use one canonical case and a restricted ASCII character set. Paths are always derived from validated IDs to prevent traversal.

## User Interface

The settings view adds a Store Management section with:

- local search by store name or ID;
- a compact store list showing name, ID, project ID, default status, and live login status;
- Add Store, Delete, Login, Check Status, and Set Default actions;
- loading, empty, error, and confirmation states.

The upload action adds a store selector initialized from `defaultStoreId`. The user can select another store for that upload. Repositories do not display or persist store bindings.

## Upload Flow

```text
Select product
  -> select store
  -> validate store and login state
  -> load the first supported variant
  -> derive store partner SKU
  -> check local SKU and barcode uniqueness
  -> check store-specific upload state
  -> acquire storeId + partnerSku task lock
  -> upload with the store profile
  -> write uploaded or failed status
  -> release task lock
```

The lock prevents concurrent requests from submitting the same SKU to the same store. A lock for one store does not block uploading the same product to another store.

## Error Handling

- Duplicate store IDs return a validation error without modifying profiles.
- A deleted store ID cannot be assigned to a different store while any historical upload record still references it.
- Deleting the default store clears `defaultStoreId`; another store is not selected silently.
- Missing or expired login blocks upload before opening the product flow.
- Local base SKU, derived SKU, or barcode collisions block upload and identify both conflicting products.
- Upload failures preserve the page behavior already used for inspection and record a sanitized error.
- Noon duplicate-SKU responses are surfaced as remote conflicts. Local checks cannot detect products created manually in Noon.
- Credentials, cookies, complete tokens, and browser profile contents are never logged or returned by APIs.

## Testing And Acceptance

Unit tests cover:

- store validation, canonical IDs, persistence, lookup, and deletion;
- profile and Noon URL derivation;
- deterministic base SKU, store SKU, variant, and barcode behavior;
- ignoring legacy profile and top-level upload status data;
- deterministic regeneration of existing SKU and Barcode values;
- store-scoped status normalization and transitions;
- duplicate and concurrent upload prevention.

API tests cover store CRUD, login/status command arguments, unknown stores, and required upload `storeId`.

UI tests cover empty state, add, search, set default, login/status feedback, delete confirmation, and upload store selection.

Existing upload, bulk export, product storage, and operation tests must continue to pass. Acceptance requires proving that:

1. Two stores can retain independent browser sessions.
2. One product produces different partner SKUs for two stores.
3. The same variant keeps the same barcode across those stores.
4. Uploading to one store does not mark another store as uploaded.
5. A repeated or concurrent upload to the same store is blocked locally.
6. Legacy local status and profile data are not imported into the new store model.

## Known Limitation

Without a Noon catalog query API, noon-tools can only guarantee uniqueness within its local product and upload records. A SKU created manually or by another machine may still conflict remotely; the Noon error remains authoritative.
