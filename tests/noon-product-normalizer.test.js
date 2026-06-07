import assert from "node:assert/strict";
import test from "node:test";
import { normalizeNoonProductVariantImages } from "../scripts/lib/noon-product-normalizer.js";

test("noon product normalizer writes variant images as string arrays", () => {
  const product = normalizeNoonProductVariantImages({
    variants: [
      {
        partner_sku: "1688-1000",
        images: [{ path: "001.jpg" }, { path: "002.jpg" }, "003.jpg", { path: "001.jpg" }],
      },
    ],
  });

  assert.deepEqual(product.variants[0].images, ["001.jpg", "002.jpg", "003.jpg"]);
});
