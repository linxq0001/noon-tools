import assert from "node:assert/strict";
import test from "node:test";
import { createSellerLabPageAdapter } from "../scripts/lib/seller-lab-page-adapter.js";

test("seller lab page adapter runs the upload page steps in order", async () => {
  const calls = [];
  const operations = {
    gotoCreatePage: async () => calls.push(["gotoCreatePage"]),
    waitForReady: async () => calls.push(["waitForReady"]),
    waitForUploadPage: async (onLoginPage) => {
      calls.push(["waitForUploadPage", typeof onLoginPage]);
      return true;
    },
    fillRequiredField: async (label, value) => calls.push(["fillRequiredField", label, value]),
    fillOptionalField: async (label, value) => calls.push(["fillOptionalField", label, value]),
    selectBrand: async (value) => calls.push(["selectBrand", value]),
    uploadImages: async (imagePaths) => calls.push(["uploadImages", imagePaths]),
    prepareProductCategory: async (categoryPath) => calls.push(["prepareProductCategory", categoryPath]),
    clickButton: async (names, options) => calls.push(["clickButton", names, options]),
    waitForStep: async (expectedStep, previousStep) => calls.push(["waitForStep", expectedStep, previousStep]),
    fillProductContent: async (product) => calls.push(["fillProductContent", product.productIdentity.partnerSku]),
    fillDetailedContent: async (product) => calls.push(["fillDetailedContent", product.productIdentity.partnerSku]),
    fillOfferDetails: async (product) => calls.push(["fillOfferDetails", product.productIdentity.partnerSku]),
  };
  const product = {
    productIdentity: {
      englishTitle: "Crystal Clutch",
      arabicTitle: "Arabic title",
      partnerSku: "1688-1001",
      brand: "No Brand",
    },
    imagePaths: ["/tmp/001.jpg"],
    category: {
      categoryPath: ["Bags & Luggage", "Handbag", "Clutch"],
    },
  };

  const adapter = createSellerLabPageAdapter(operations);

  assert.equal(await adapter.openCreatePage(() => {}), true);
  await adapter.fillProductIdentity(product);
  await adapter.continueFromProductIdentity(product);
  await adapter.fillProductContent(product);
  await adapter.fillDetailedContent(product);
  await adapter.submitOfferDetails(product);

  assert.deepEqual(calls, [
    ["gotoCreatePage"],
    ["waitForReady"],
    ["waitForUploadPage", "function"],
    ["fillRequiredField", "English Title", "Crystal Clutch"],
    ["fillOptionalField", "Arabic Title", "Arabic title"],
    ["fillRequiredField", "Partner SKU", "1688-1001"],
    ["selectBrand", "No Brand"],
    ["uploadImages", ["/tmp/001.jpg"]],
    ["prepareProductCategory", ["Bags & Luggage", "Handbag", "Clutch"]],
    ["clickButton", ["Create & Continue", "Continue"], { required: true }],
    ["waitForStep", "Product Content", "Product Identity"],
    ["fillProductContent", "1688-1001"],
    ["fillDetailedContent", "1688-1001"],
    ["clickButton", ["Save & Continue", "Create & Continue", "Continue", "Next"], { required: false }],
    ["waitForStep", "Offer Details", "Detailed Content"],
    ["fillOfferDetails", "1688-1001"],
    ["clickButton", ["Submit", "Create Product", "Create & Submit", "Publish", "Create"], { required: true }],
  ]);
});
