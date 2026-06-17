import assert from "node:assert/strict";
import test from "node:test";
import { calculateNoonProfit, normalizeProfitConfig } from "../scripts/lib/noon-profit.js";

test("calculateNoonProfit returns suggested price for target margin", () => {
  const result = calculateNoonProfit({
    costCny: 38,
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
  });

  assert.equal(result.suggestedPriceAed, 35.45);
  assert.equal(result.estimatedProfitAed, 9.93);
  assert.equal(result.margin, 0.28);
  assert.equal(result.belowTarget, false);
  assert.deepEqual(result.warnings, []);
});

test("calculateNoonProfit evaluates an existing sale price", () => {
  const result = calculateNoonProfit({
    costCny: 38,
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
    salePriceAed: 29,
  });

  assert.equal(result.suggestedPriceAed, 35.45);
  assert.equal(result.estimatedProfitAed, 3.55);
  assert.equal(result.margin, 0.12);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "low_margin",
      message: "毛利率 12% 低于目标利润率 28%。",
    },
  ]);
});

test("normalizeProfitConfig accepts numeric strings and defaults", () => {
  assert.deepEqual(
    normalizeProfitConfig({
      costCny: "38.5",
      shippingCny: "11.5",
      exchangeRate: "1.96",
      platformFeeRate: "12%",
      targetMargin: "28%",
    }),
    {
      costCny: 38.5,
      shippingCny: 11.5,
      exchangeRate: 1.96,
      platformFeeRate: 0.12,
      targetMargin: 0.28,
    },
  );
});

test("calculateNoonProfit reports invalid cost inputs", () => {
  const result = calculateNoonProfit({
    costCny: "",
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.12,
    targetMargin: 0.28,
  });

  assert.equal(result.suggestedPriceAed, 0);
  assert.equal(result.estimatedProfitAed, 0);
  assert.equal(result.margin, 0);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "missing_cost",
      message: "缺少商品成本，无法计算利润。",
    },
  ]);
});
