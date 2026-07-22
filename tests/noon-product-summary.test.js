import assert from "node:assert/strict";
import test from "node:test";
import { summarizeNoonProduct } from "../scripts/lib/noon-product-summary.js";

test("summarizeNoonProduct returns a lightweight listing summary", () => {
  const summary = summarizeNoonProduct(
      {
        product_group: {
          product_group_name_en: "Evening Clutch Bag",
          hs_code: "420222",
        },
      variants: [
        {
          partner_sku: "G-1001-1001-V01-SILVER",
          model_number: "G-1001-1001-V01-SILVER",
          barcode: "202604280001",
          colour: "Grey",
          colour_name: "Silver",
          price_sar_initial: 99,
          price_usd: 18.5,
          stock: 8,
          processing_time: "2_days",
          length_cm: 20,
          width_cm: 5,
          height_cm: 10,
          actual_weight_kg: 0.6,
          images: ["images/silver-1.jpg", { path: "images/silver-2.jpg" }],
        },
      ],
    },
    {
      imageUrl: (image) => `/products/1688/default/1001/${image}`,
    },
  );

  assert.equal(summary.title, "Evening Clutch Bag");
  assert.equal(summary.variantCount, 1);
  assert.equal(summary.imageCount, 2);
  assert.equal(summary.partnerSku, "G-1001-1001-V01-SILVER");
  assert.equal(summary.hsCode, "420222");
  assert.equal("weightKg" in summary, false);
  assert.equal("sizeText" in summary, false);
  assert.equal("variants" in summary, false);
});

test("summarizeNoonProduct keeps listing summary lightweight for numeric colour values", () => {
  const summary = summarizeNoonProduct({
    product_group: {
      product_group_name_en: "Sequin Clutch",
    },
    variants: [
      {
        partner_sku: "G-1001-1038354457118-V08-17500142",
        model_number: "G-1001-1038354457118-V08-17500142",
        barcode: "982410932730",
        colour: "17500142",
        colour_name: "17500142",
        price_sar_initial: 12,
        stock: 0,
        processing_time: "2_days",
        length_cm: 20,
        width_cm: 5,
        height_cm: 10,
        actual_weight_kg: 1,
        images: [],
      },
    ],
  });

  assert.equal(summary.partnerSku, "G-1001-1038354457118-V08-17500142");
  assert.equal(summary.variantCount, 1);
  assert.equal("variants" in summary, false);
});
