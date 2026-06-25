import assert from "node:assert/strict";
import test from "node:test";
import { createSellerLabPageOperations } from "../scripts/lib/seller-lab-page-operations.js";

test("seller lab page operations binds helpers to a page", async () => {
  const page = { id: "page-1" };
  const calls = [];
  const helpers = {
    gotoNoonCreatePage: async (pageArg) => calls.push(["gotoNoonCreatePage", pageArg.id]),
    waitForReady: async (pageArg) => calls.push(["waitForReady", pageArg.id]),
    waitForUploadPage: async (pageArg, onLoginPage) => calls.push(["waitForUploadPage", pageArg.id, typeof onLoginPage]),
    fillRequiredField: async (pageArg, label, value) => calls.push(["fillRequiredField", pageArg.id, label, value]),
    fillOptionalField: async (pageArg, label, value, options) => calls.push(["fillOptionalField", pageArg.id, label, value, options]),
    selectBrand: async (pageArg, value) => calls.push(["selectBrand", pageArg.id, value]),
    uploadImages: async (pageArg, imagePaths) => calls.push(["uploadImages", pageArg.id, imagePaths]),
    prepareProductCategory: async (pageArg, categoryPath) => calls.push(["prepareProductCategory", pageArg.id, categoryPath]),
    clickButton: async (pageArg, names, options) => calls.push(["clickButton", pageArg.id, names, options]),
    waitForStep: async (pageArg, expectedStep, previousStep) => calls.push(["waitForStep", pageArg.id, expectedStep, previousStep]),
    fillProductContent: async (pageArg, product) => calls.push(["fillProductContent", pageArg.id, product.sku]),
    fillDetailedContent: async (pageArg, product) => calls.push(["fillDetailedContent", pageArg.id, product.sku]),
    fillOfferDetails: async (pageArg, product) => calls.push(["fillOfferDetails", pageArg.id, product.sku]),
  };

  const operations = createSellerLabPageOperations(page, helpers);
  await operations.gotoCreatePage();
  await operations.waitForReady();
  await operations.waitForUploadPage(() => {});
  await operations.fillRequiredField("English Title", "Bag");
  await operations.fillOptionalField("Arabic Title", "", { blocking: false });
  await operations.selectBrand("No Brand");
  await operations.uploadImages(["001.jpg"]);
  await operations.prepareProductCategory(["Bags & Luggage"]);
  await operations.clickButton(["Continue"], { required: true });
  await operations.waitForStep("Product Content", "Product Identity");
  await operations.fillProductContent({ sku: "1688-1001" });
  await operations.fillDetailedContent({ sku: "1688-1001" });
  await operations.fillOfferDetails({ sku: "1688-1001" });

  assert.deepEqual(calls, [
    ["gotoNoonCreatePage", "page-1"],
    ["waitForReady", "page-1"],
    ["waitForUploadPage", "page-1", "function"],
    ["fillRequiredField", "page-1", "English Title", "Bag"],
    ["fillOptionalField", "page-1", "Arabic Title", "", { blocking: false }],
    ["selectBrand", "page-1", "No Brand"],
    ["uploadImages", "page-1", ["001.jpg"]],
    ["prepareProductCategory", "page-1", ["Bags & Luggage"]],
    ["clickButton", "page-1", ["Continue"], { required: true }],
    ["waitForStep", "page-1", "Product Content", "Product Identity"],
    ["fillProductContent", "page-1", "1688-1001"],
    ["fillDetailedContent", "page-1", "1688-1001"],
    ["fillOfferDetails", "page-1", "1688-1001"],
  ]);
});
