export function createSellerLabPageAdapter(operations) {
  return new SellerLabPageAdapter(operations);
}

class SellerLabPageAdapter {
  constructor(operations) {
    this.operations = operations;
  }

  async openCreatePage(onLoginPage) {
    await this.operations.gotoCreatePage();
    await this.operations.waitForReady();
    return this.operations.waitForUploadPage(onLoginPage);
  }

  async fillProductIdentity(product) {
    await this.operations.fillRequiredField("English Title", product.productIdentity.englishTitle);
    await this.operations.fillOptionalField("Arabic Title", product.productIdentity.arabicTitle);
    await this.operations.fillRequiredField("Partner SKU", product.productIdentity.partnerSku);
    await this.operations.selectBrand(product.productIdentity.brand || "No Brand");
    await this.operations.uploadImages(product.imagePaths);
  }

  async continueFromProductIdentity(product) {
    await this.operations.prepareProductCategory(product.category?.categoryPath ?? []);
    await this.operations.clickButton(["Create & Continue", "Continue"], { required: true });
    await this.operations.waitForStep("Product Content", "Product Identity");
  }

  async fillProductContent(product) {
    await this.operations.fillProductContent(product);
  }

  async fillDetailedContent(product) {
    await this.operations.fillDetailedContent(product);
    await this.operations.clickButton(["Save & Continue", "Create & Continue", "Continue", "Next"], { required: false });
    await this.operations.waitForStep("Offer Details", "Detailed Content");
  }

  async submitOfferDetails(product) {
    await this.operations.fillOfferDetails(product);
    await this.operations.clickButton(["Submit", "Create Product", "Create & Submit", "Publish", "Create"], { required: true });
  }

  async createProductGroup(product) {
    return this.operations.createProductGroup(product);
  }

  async joinProductGroup(product, groupRef) {
    await this.operations.joinProductGroup(product, groupRef);
  }
}
