export function summarizeNoonProduct(product, { imageUrl = (image) => image } = {}) {
	  if (product?.product_group) {
	    const variants = Array.isArray(product.variants) ? product.variants : [];
	    const firstVariant = variants[0] || {};
	    const hasOfferPrices = variants.length > 0 && variants.every((variant) => hasValue(variant.price_sar_initial ?? variant.price));
	    const blockingIssues = (product.submission_gate?.blockingIssues || []).filter(
	      (issue) => !(hasOfferPrices && issue.includes("Source price is CNY")),
	    );

    return {
      title: product.product_group.product_group_name_en || "",
      variantCount: variants.length,
	      imageCount: Math.max(...variants.map((variant) => (variant.images || []).length), 0),
	      partnerSku: cleanText(firstVariant.partner_sku),
	      hsCode: cleanText(product.product_group.hs_code),
	      gateStatus: blockingIssues.length > 0 ? product.submission_gate?.status || "" : "ready_for_manual_review",
	      blockingIssues,
	      warnings: product.submission_gate?.warnings || [],
      sourcePrice: product.submission_gate?.sourcePrice || null,
      blockingCount: blockingIssues.length,
      operationStatus: product.operation_status || "active",
      operationCheck: product.operation_check || null,
    };
  }

  return {
    title: product?.productIdentity?.englishTitle || "",
    variantCount: product?.offerDetails?.offers?.length || 1,
    imageCount: product?.productIdentity?.productImages?.length || 0,
    gateStatus: "",
    blockingCount: 0,
    operationStatus: product?.operation_status || "active",
    operationCheck: product?.operation_check || null,
  };
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}
