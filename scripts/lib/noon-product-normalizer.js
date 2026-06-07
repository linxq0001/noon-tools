export function normalizeNoonProductVariantImages(product) {
  if (!product || !Array.isArray(product.variants)) return product;

  return {
    ...product,
    variants: product.variants.map((variant) => ({
      ...variant,
      images: normalizeImagePaths(variant.images),
    })),
  };
}

function normalizeImagePaths(images) {
  return [...new Set((Array.isArray(images) ? images : []).map(imagePath).filter(Boolean))];
}

function imagePath(image) {
  if (typeof image === "string") return image;
  if (image && typeof image === "object") return image.path || image.url || image.source || "";
  return "";
}
