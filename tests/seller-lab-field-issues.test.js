import assert from "node:assert/strict";
import test from "node:test";
import { createSellerLabFieldIssues } from "../scripts/lib/seller-lab-field-issues.js";

test("seller lab field issues records unique labels and resets", () => {
  const issues = createSellerLabFieldIssues();

  issues.record("Casing");
  issues.record("Casing");
  issues.record("Closure");

  assert.deepEqual(issues.list(), ["Casing", "Closure"]);
  assert.throws(
    () => issues.assertClear("Detailed Content"),
    /Detailed Content fields were not confirmed on the noon page: Casing, Closure/,
  );

  issues.reset();
  assert.deepEqual(issues.list(), []);
  assert.doesNotThrow(() => issues.assertClear("Detailed Content"));
});
