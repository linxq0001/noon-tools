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

  assert.equal(result.suggestedPriceAed, 42.52);
  assert.equal(result.estimatedProfitAed, 11.91);
  assert.equal(result.margin, 0.28);
  assert.equal(result.belowTarget, false);
  assert.deepEqual(result.warnings, []);
});

test("calculateNoonProfit keeps exact total cost before rounding outputs", () => {
  const result = calculateNoonProfit({
    costCny: 1,
    shippingCny: 0,
    exchangeRate: 1.23,
    platformFeeRate: 0.05,
    targetMargin: 0.1,
  });

  assert.equal(result.suggestedPriceAed, 0.96);
  assert.equal(result.estimatedProfitAed, 0.1);
  assert.equal(result.margin, 0.1);
  assert.equal(result.belowTarget, false);
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

  assert.equal(result.suggestedPriceAed, 42.52);
  assert.equal(result.estimatedProfitAed, 0.01);
  assert.equal(result.margin, 0);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "low_margin",
      message: "毛利率 0% 低于目标利润率 28%。",
    },
  ]);
});

test("calculateNoonProfit treats rounded tie margin as meeting target", () => {
  const result = calculateNoonProfit({
    costCny: 72.1,
    shippingCny: 0,
    exchangeRate: 1,
    platformFeeRate: 0,
    targetMargin: 0.28,
    salePriceAed: 100,
  });

  assert.equal(result.margin, 0.28);
  assert.equal(result.belowTarget, false);
});

test("calculateNoonProfit reports invalid margin config", () => {
  const result = calculateNoonProfit({
    costCny: 38,
    shippingCny: 12,
    exchangeRate: 1.96,
    platformFeeRate: 0.8,
    targetMargin: 0.25,
  });

  assert.equal(result.suggestedPriceAed, 0);
  assert.equal(result.belowTarget, true);
  assert.deepEqual(result.warnings, [
    {
      code: "invalid_margin_config",
      message: "平台费率和目标利润率之和必须小于 100%。",
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

test("normalizeProfitConfig preserves explicit zero target margin", () => {
  for (const targetMargin of [0, "0", "0.0", "0%"]) {
    assert.equal(normalizeProfitConfig({ targetMargin }).targetMargin, 0);
  }
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
