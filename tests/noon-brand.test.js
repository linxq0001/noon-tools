import assert from "node:assert/strict";
import test from "node:test";
import { brandCandidates, isNoBrandValue, normalizeBrandValue } from "../scripts/lib/noon-brand.js";

test("normalizeBrandValue treats blank brands as no brand", () => {
  assert.equal(normalizeBrandValue(""), "No Brand");
  assert.equal(normalizeBrandValue("  "), "No Brand");
});

test("brandCandidates tries no-brand labels for Generic", () => {
  assert.deepEqual(brandCandidates("Generic"), ["No Brand", "Not Applicable", "Unbranded", "None", "Generic"]);
});

test("brandCandidates keeps real brand names unchanged", () => {
  assert.deepEqual(brandCandidates("Acme"), ["Acme"]);
});

test("isNoBrandValue detects generic placeholders", () => {
  assert.equal(isNoBrandValue("Generic"), true);
  assert.equal(isNoBrandValue("No Brand"), true);
  assert.equal(isNoBrandValue("Acme"), false);
});
