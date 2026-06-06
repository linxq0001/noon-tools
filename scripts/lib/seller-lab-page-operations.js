export function createSellerLabPageOperations(page, helpers) {
  return {
    gotoCreatePage: () => helpers.gotoNoonCreatePage(page),
    waitForReady: () => helpers.waitForReady(page),
    waitForUploadPage: (onLoginPage) => helpers.waitForUploadPage(page, onLoginPage),
    fillRequiredField: (label, value) => helpers.fillRequiredField(page, label, value),
    fillOptionalField: (label, value, options) => helpers.fillOptionalField(page, label, value, options),
    selectBrand: (value) => helpers.selectBrand(page, value),
    uploadImages: (imagePaths) => helpers.uploadImages(page, imagePaths),
    prepareProductCategory: (categoryPath) => helpers.prepareProductCategory(page, categoryPath),
    clickButton: (names, options) => helpers.clickButton(page, names, options),
    waitForStep: (expectedStep, previousStep) => helpers.waitForStep(page, expectedStep, previousStep),
    fillProductContent: (product) => helpers.fillProductContent(page, product),
    fillDetailedContent: (product) => helpers.fillDetailedContent(page, product),
    fillOfferDetails: (product) => helpers.fillOfferDetails(page, product),
  };
}
