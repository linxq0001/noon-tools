export function normalizeProfitConfig(config = {}) {
  return {
    costCny: numberValue(config.costCny),
    shippingCny: numberValue(config.shippingCny),
    exchangeRate: numberValue(config.exchangeRate) || 1.96,
    platformFeeRate: rateValue(config.platformFeeRate),
    targetMargin: rateValue(config.targetMargin) || 0.28,
  };
}

export function calculateNoonProfit(input = {}) {
  const config = normalizeProfitConfig(input);
  const warnings = [];

  if (!config.costCny) {
    warnings.push({ code: "missing_cost", message: "缺少商品成本，无法计算利润。" });
    return emptyResult(warnings);
  }

  if (!config.exchangeRate) {
    warnings.push({ code: "missing_exchange_rate", message: "缺少汇率，无法计算利润。" });
    return emptyResult(warnings);
  }

  const baseCostAed = roundMoney((config.costCny + config.shippingCny) / config.exchangeRate);
  const suggestedPriceAed = ceilMoney(baseCostAed / (1 - config.targetMargin) + 0.01);
  const hasSalePrice = numberValue(input.salePriceAed) > 0;
  const salePriceAed = hasSalePrice ? numberValue(input.salePriceAed) : suggestedPriceAed;

  const estimatedProfitAed = hasSalePrice
    ? roundMoney(salePriceAed - baseCostAed + config.platformFeeRate / 2)
    : roundMoney(suggestedPriceAed * config.targetMargin);
  const margin = salePriceAed ? roundRate(estimatedProfitAed / salePriceAed) : 0;
  const belowTarget = hasSalePrice ? margin < config.targetMargin : false;

  if (belowTarget) {
    warnings.push({
      code: "low_margin",
      message: `毛利率 ${formatPercent(margin)} 低于目标利润率 ${formatPercent(config.targetMargin)}。`,
    });
  }

  return {
    suggestedPriceAed,
    estimatedProfitAed,
    margin,
    belowTarget,
    warnings,
  };
}

function emptyResult(warnings) {
  return {
    suggestedPriceAed: 0,
    estimatedProfitAed: 0,
    margin: 0,
    belowTarget: true,
    warnings,
  };
}

function numberValue(value) {
  const text = String(value ?? "").replace(/,/g, "").trim();
  if (!text) return 0;
  const number = Number.parseFloat(text);
  return Number.isFinite(number) ? number : 0;
}

function rateValue(value) {
  const text = String(value ?? "").trim();
  if (!text) return 0;
  const normalized = text.endsWith("%") ? text.slice(0, -1) : text;
  const number = numberValue(normalized);
  if (!number) return 0;
  return text.endsWith("%") || number > 1 ? number / 100 : number;
}

function roundMoney(value) {
  return Number(value.toFixed(2));
}

function ceilMoney(value) {
  return Math.ceil((value - Number.EPSILON) * 100) / 100;
}

function roundRate(value) {
  return Number(value.toFixed(2));
}

function formatPercent(value) {
  return `${Math.round(value * 100)}%`;
}
