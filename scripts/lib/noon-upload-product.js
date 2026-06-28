import { readdir } from "node:fs/promises";
import { normalizeBrandValue } from "./noon-brand.js";
import { scopeProductToStore } from "./noon-upload-preflight.js";

export async function prepareNoonUploadProduct(rawProduct, productDir, storeId) {
  const products = await prepareNoonUploadProducts(rawProduct, productDir, storeId);
  return products[0];
}

export async function prepareNoonUploadProducts(rawProduct, productDir, storeId) {
  if (!rawProduct?.product_group || !Array.isArray(rawProduct.variants)) {
    throw new Error("Noon upload product must use current product_group + variants format.");
  }

  const products = [];
  for (const [variantIndex] of rawProduct.variants.entries()) {
    products.push(scopeProductToStore(await normalizeNoonUploadProduct(rawProduct, productDir, variantIndex), storeId));
  }
  return products;
}

export async function normalizeNoonUploadProduct(product, productDir, variantIndex = 0) {
  if (!product?.product_group || !Array.isArray(product.variants)) {
    throw new Error("Noon upload product must use current product_group + variants format.");
  }

  const group = product.product_group;
  const variant = product.variants[variantIndex] ?? {};
  const localImages = await listLocalProductImages(productDir);
  const variantImages = valueFor(variant, group, "images", [])
    .map((image) => (typeof image === "string" ? image : image.path))
    .filter(Boolean);

  return {
    productIdentity: {
      englishTitle: translateUploadText(variant.title_en || group.product_group_name_en || ""),
      arabicTitle: variant.title_ar || group.product_group_name_ar || "",
      partnerSku: variant.partner_sku || "",
      brand: normalizeBrandValue(group.brand),
      hasNoBrandName: normalizeBrandValue(group.brand) === "No Brand",
      productImages: variantImages.length > 0 ? variantImages : localImages,
    },
    category: {
      categoryId: null,
      categoryPath: group.category ? String(group.category).split(">").map((item) => item.trim()) : [],
      similarNoonProductUrl: null,
    },
    productContent: {
      featureBullets: valueFor(variant, group, "feature_bullets_en", []),
      longDescription: valueFor(variant, group, "description_en", ""),
      arabicLongDescription: valueFor(variant, group, "description_ar", ""),
      gender: group.gender ?? null,
      gtin: "",
    },
    detailedContent: {
      features: splitDetailValues(group.features),
      careInstructions: group.care_instructions ?? "",
      casing: group.casing ?? "",
      closure: group.closure ?? "",
      type: group.type ?? "",
      colour: translateUploadText(variant.colour ?? ""),
      colourName: translateUploadText(variant.colour_name ?? ""),
      compatibility: "",
      countryOfOrigin: group.country_of_origin ?? "",
      exteriorMaterial: group.exterior_material ?? "",
      style: "",
      hsCode: group.hs_code ?? "",
      interiorMaterial: group.interior_material ?? "",
      itemCondition: group.item_condition ?? "New",
      materialComposition: group.material_composition ?? "",
      modelName: group.model_name ?? "",
      modelNumber: variant.model_number ?? variant.partner_sku ?? "",
      msrpAE: null,
      msrpEG: null,
      msrpSA: null,
      seasonCode: "",
      occasion: group.occasion ?? "",
      pattern: "",
      productHeight: valueFor(variant, group, "height_cm", null),
      productHeightUnit: "cm",
      productLength: valueFor(variant, group, "length_cm", null),
      productLengthUnit: "cm",
      productWeight: valueFor(variant, group, "actual_weight_kg", null),
      productWeightUnit: "kg",
      productWidth: valueFor(variant, group, "width_cm", null),
      productWidthUnit: "cm",
      size: group.size ?? "",
      sizeUnit: group.size_unit ?? "",
      strapMaterial: group.strap_material ?? "",
      whatsInTheBox: group.what_is_in_the_box ?? "",
      year: group.year ?? null,
    },
    offerDetails: {
      offerType: "single_product",
      offers: [
        {
          size: group.size ?? "",
          partnerSku: variant.partner_sku ?? "",
          price: valueFor(variant, group, "price_sar_initial", null),
          currency: "SAR",
          barcode: variant.barcode ?? "",
          warehouse: valueFor(variant, group, "warehouse_name", valueFor(variant, group, "warehouse_code", "")),
          stock: valueFor(variant, group, "stock", null),
        },
      ],
    },
  };
}

async function listLocalProductImages(productDir) {
  const entries = await readdir(productDir);

  return entries
    .filter((entry) => /\.(?:jpe?g|png|webp|gif)$/i.test(entry))
    .sort((left, right) => left.localeCompare(right, "en", { numeric: true }))
    .slice(0, 9);
}

function splitDetailValues(value) {
  if (Array.isArray(value)) return value;
  if (!hasValue(value)) return [];
  return String(value)
    .split(/[,，/]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function translateUploadText(value) {
  const replacements = new Map([
    ["紫色", "Purple"],
    ["玫红色", "Rose Red"],
    ["金色", "Gold"],
    ["绿色", "Green"],
    ["黑色", "Black"],
    ["橘色", "Orange"],
    ["银色", "Silver"],
    ["蓝色", "Blue"],
    ["白色", "White"],
    ["红色", "Red"],
    ["粉色", "Pink"],
  ]);

  let text = String(value || "");
  for (const [source, target] of replacements) {
    text = text.replaceAll(source, target);
  }
  return text;
}

function valueFor(variant, group, field, fallback = "") {
  return variant[field] ?? group[field] ?? fallback;
}

function hasValue(value) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}
