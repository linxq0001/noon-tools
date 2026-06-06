import assert from "node:assert/strict";
import test from "node:test";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import XLSX from "xlsx";

const rootDir = path.resolve(import.meta.dirname, "..");

test("import:nis-meta writes one meta.json per NIS product row", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-meta-"));
  const workbookPath = path.join(tempDir, "NIS.xlsx");
  const outDir = path.join(tempDir, "products");
  await mkdir(outDir);

  const rows = [
    ["Template metadata"],
    [],
    [],
    [],
    [],
    [],
    [],
    [
      "Family",
      "Product Type",
      "Product Subtype",
      "Brand",
      "Product Title EN",
      "Product Title AR",
      "Partner SKU Unique",
      "Colour Name EN",
      "Material",
      "Feature Bullet 1 EN",
      "Image URL 1",
      "Image URL 2",
      "Shipping Weight",
      "Shipping Weight Unit",
      "Recommended Retail Price AE",
    ],
    [
      "family",
      "product_type",
      "product_subtype",
      "brand",
      "product_title_en",
      "product_title_ar",
      "seller_sku",
      "colour_name_en",
      "material",
      "feature_bullet_1_en",
      "image_url_1",
      "image_url_2",
      "shipping_weight",
      "shipping_weight_unit",
      "msrp_ae",
    ],
    [
      "Bags & Luggage",
      "Handbag",
      "Clutch",
      "Generic",
      "Rhinestone Clutch Bag",
      "Arabic title",
      "SBS-123-GLD",
      "Gold",
      "Acrylic",
      "Compact evening clutch",
      "https://example.com/1.jpg",
      "https://example.com/2.jpg",
      0.6,
      "kg",
      99,
    ],
  ];

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.writeFile(workbook, workbookPath);

  const result = spawnSync(process.execPath, ["scripts/import-nis-meta.js", workbookPath, "--out", outDir], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const meta = JSON.parse(await readFile(path.join(outDir, "SBS-123-GLD-Rhinestone Clutch Bag", "meta.json"), "utf8"));
  assert.equal(meta.productId, "SBS-123-GLD");
  assert.equal(meta.title, "Rhinestone Clutch Bag");
  assert.deepEqual(meta.images, ["https://example.com/1.jpg", "https://example.com/2.jpg"]);
  assert.deepEqual(meta.category, {
    family: "Bags & Luggage",
    productType: "Handbag",
    productSubtype: "Clutch",
  });
  assert.equal(meta.packageInfo.weightG, "600");
  assert.equal(meta.price, "99");
  assert.equal(meta.noon.brand, "Generic");
  assert.equal(meta.noon.productTitleAr, "Arabic title");
  assert.deepEqual(meta.noon.featureBulletsEn, ["Compact evening clutch"]);
  assert.equal(meta.noon.attributes["Colour Name EN"], "Gold");
  assert.equal(meta.noon.attributes.Material, "Acrylic");
});

test("import:nis-meta keeps category-only rows traceable when Partner SKU is missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-meta-"));
  const workbookPath = path.join(tempDir, "NIS.xlsx");
  const outDir = path.join(tempDir, "products");
  await mkdir(outDir);

  const rows = [
    ["Template metadata"],
    ["Template Name"],
    ["Locale"],
    ["Optional"],
    ["Template Type"],
    ["Dropdown"],
    ["Example"],
    ["Family", "Product Type", "Product Subtype", "Partner SKU Unique", "Product Title EN"],
    ["family", "product_type", "product_subtype", "seller_sku", "product_title_en"],
    ["Bags & Luggage", "Handbag", "Clutch", "", ""],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.writeFile(workbook, workbookPath);

  const result = spawnSync(process.execPath, ["scripts/import-nis-meta.js", workbookPath, "--out", outDir], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const meta = JSON.parse(await readFile(path.join(outDir, "nis-row-10-Clutch", "meta.json"), "utf8"));
  assert.equal(meta.productId, "nis-row-10");
  assert.equal(meta.title, "Clutch");
  assert.deepEqual(meta.missingFields, ["Partner SKU Unique", "Product Title EN"]);
  assert.deepEqual(meta.category, {
    family: "Bags & Luggage",
    productType: "Handbag",
    productSubtype: "Clutch",
  });
});

test("export:nis-meta fills NIS rows from collected noon product attributes", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-export-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1001-clutch");
  const templatePath = path.join(tempDir, "NIS.xlsx");
  const outputPath = path.join(tempDir, "configured-nis.xlsx");
  await mkdir(productDir, { recursive: true });

  const rows = [
    ["Template metadata"],
    ["Template Name"],
    ["Locale"],
    ["Optional"],
    ["Template Type"],
    ["Dropdown"],
    ["Example"],
    [
      "Family",
      "Product Type",
      "Product Subtype",
      "Brand",
      "Product Title EN",
      "Product Title AR",
      "Partner SKU Unique",
      "Style or Part Number",
      "Colour Name EN",
      "Colour Family",
      "Item Condition",
      "Size",
      "Size Unit",
      "Department",
      "Material",
      "Occasion",
      "Exterior Material",
      "Casing",
      "Closure/Fastener",
      "Material Composition EN",
      "Long Description EN",
      "Long Description AR",
      "What's In The Box EN",
      "Year",
      "Feature 1",
      "Feature 2",
      "Feature 3",
      "Feature 4",
      "Feature 5",
      "Feature Bullet 1 EN",
      "Feature Bullet 1 AR",
      "Image URL 1",
      "Image URL 2",
      "GTIN",
      "HS Code",
      "Country of Origin",
      "Shipping Weight",
      "Shipping Weight Unit",
      "Recommended Retail Price SA",
    ],
    [
      "family",
      "product_type",
      "product_subtype",
      "brand",
      "product_title_en",
      "product_title_ar",
      "seller_sku",
      "model_number",
      "colour_name_en",
      "colour_family",
      "item_condition",
      "size",
      "size_unit",
      "department",
      "material",
      "occasion",
      "exterior_material",
      "casing",
      "closure_fastener",
      "material_composition_en",
      "long_description_en",
      "long_description_ar",
      "whats_in_the_box_en",
      "year",
      "bags_luggage_feature_1",
      "bags_luggage_feature_2",
      "bags_luggage_feature_3",
      "bags_luggage_feature_4",
      "bags_luggage_feature_5",
      "feature_bullet_1_en",
      "feature_bullet_1_ar",
      "image_url_1",
      "image_url_2",
      "gtin",
      "hs_code",
      "country_of_origin",
      "shipping_weight",
      "shipping_weight_unit",
      "msrp_sa",
    ],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.utils.book_append_sheet(
    workbook,
    XLSX.utils.aoa_to_sheet([
      ["family", "product_type", "product_subtype", "material", "exterior_material", "casing", "closure_fastener", "feature"],
      ["No option Available", "No option Available", "No option Available", "PU", "PU", "Hardside", "Zip", "Lightweight"],
      ["", "", "", "Polyester", "Polyester", "Hybrid", "Clasp", "Detachable Straps"],
      ["", "", "", "Synthetic", "Synthetic", "Softside", "Magnetic", "Multi Compartment"],
    ]),
    "valid values",
  );
  workbook.Workbook = {
    Names: [
      { Name: "valid_values_family", Ref: "'valid values'!$A$2:$A$2" },
      { Name: "valid_values_product_type", Ref: "'valid values'!$B$2:$B$2" },
      { Name: "valid_values_product_subtype", Ref: "'valid values'!$C$2:$C$2" },
      { Name: "valid_values_material", Ref: "'valid values'!$D$2:$D$4" },
      { Name: "valid_values_exterior_material", Ref: "'valid values'!$E$2:$E$4" },
      { Name: "valid_values_casing", Ref: "'valid values'!$F$2:$F$4" },
      { Name: "valid_values_closure_fastener", Ref: "'valid values'!$G$2:$G$4" },
      { Name: "valid_values_bags_luggage_feature_1", Ref: "'valid values'!$H$2:$H$4" },
      { Name: "valid_values_bags_luggage_feature_2", Ref: "'valid values'!$H$2:$H$4" },
      { Name: "valid_values_bags_luggage_feature_3", Ref: "'valid values'!$H$2:$H$4" },
      { Name: "valid_values_bags_luggage_feature_4", Ref: "'valid values'!$H$2:$H$4" },
      { Name: "valid_values_bags_luggage_feature_5", Ref: "'valid values'!$H$2:$H$4" },
    ],
  };
  XLSX.writeFile(workbook, templatePath);

  await writeJson(path.join(productDir, "meta.json"), {
    productId: "1001",
    title: "Rhinestone Chain Clutch Bag",
    attributes: {
      "包内部结构": "手机袋",
      "流行元素": "镶钻,链条",
    },
    images: ["https://example.com/1.jpeg", "https://example.com/2.jpeg"],
    packageInfo: { weightG: "600" },
  });
  await writeJson(path.join(productDir, "noon-product-attributes.json"), {
    product_group: {
      product_group_name_en: "Crystal Clutch",
      product_group_name_ar: "حقيبة كريستال",
      category: "Bags & Luggage > Handbag > Clutch",
      brand: "Generic",
      gender: "Women",
      hs_code: "420222",
      country_of_origin: "China",
      exterior_material: "pu",
      material_composition: "Polyester, Rhinestone",
      occasion: "Party",
      size: "One Size",
      size_unit: "cm",
      year: "2026",
      features: ["Lightweight"],
      casing: "Hard Case",
      closure: "Zipper",
      item_condition: "New",
      what_is_in_the_box: "1 x Evening Clutch Bag",
    },
    variants: [
      {
        partner_sku: "1688-1001-GOLD",
        barcode: "202606040001",
        colour_name: "Gold",
        title_en: "Crystal Clutch, Gold",
        title_ar: "حقيبة كريستال، ذهبي",
        description_en: "Evening clutch for parties.",
        description_ar: "حقيبة سهرة للحفلات.",
        feature_bullets_en: ["Decorative rhinestone detail."],
        feature_bullets_ar: ["تفاصيل كريستال زخرفية."],
        model_number: "1688-1001-GOLD",
        actual_weight_kg: 0.6,
        price_sar_initial: 99,
      },
    ],
  });

  const result = spawnSync(process.execPath, ["scripts/export-nis-meta.js", productsDir, templatePath, outputPath], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const exported = XLSX.readFile(outputPath);
  assert.deepEqual(exported.SheetNames, ["template_data", "valid values"]);
  const exportedRows = XLSX.utils.sheet_to_json(exported.Sheets.template_data, { header: 1, defval: "" });
  const row = exportedRows[9];
  assert.equal(row[0], "Bags & Luggage");
  assert.equal(row[1], "Handbag");
  assert.equal(row[2], "Clutch");
  assert.equal(row[3], "Generic");
  assert.equal(row[4], "Crystal Clutch, Gold");
  assert.equal(row[6], "1688-1001-GOLD");
  assert.equal(row[8], "Gold");
  assert.equal(row[14], "Polyester");
  assert.equal(row[16], "PU");
  assert.equal(row[17], "Hardside");
  assert.equal(row[18], "Zip");
  assert.equal(row[24], "Lightweight");
  assert.equal(row[25], "");
  assert.equal(row[26], "");
  assert.equal(row[29], "Decorative rhinestone detail.");
  assert.equal(row[31], "https://example.com/1.jpeg");
  assert.equal(row[33], "");
  assert.equal(row[36], 0.6);
  assert.equal(row[37], "Kilogram");
  assert.equal(row[38], 99);
});

test("export:nis-meta creates one NIS row per meta color when noon attributes are missing", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-export-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1002-bag");
  const templatePath = path.join(tempDir, "NIS.xlsx");
  const outputPath = path.join(tempDir, "configured-nis.xlsx");
  await mkdir(productDir, { recursive: true });

  const rows = [
    ["Template metadata"],
    ["Template Name"],
    ["Locale"],
    ["Optional"],
    ["Template Type"],
    ["Dropdown"],
    ["Example"],
    ["Family", "Product Type", "Product Subtype", "Product Title EN", "Partner SKU Unique", "Brand", "Colour Name EN", "Material", "Image URL 1"],
    ["family", "product_type", "product_subtype", "product_title_en", "seller_sku", "brand", "colour_name_en", "material", "image_url_1"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.writeFile(workbook, templatePath);

  await writeJson(path.join(productDir, "meta.json"), {
    productId: "1002",
    title: "Rhinestone Bag",
    attributes: {
      "品牌": "Other",
      "颜色": "银色,黑色",
      "材质": "涤纶",
    },
    images: [
      "https://cbu01.alicdn.com/img/ibank/example.jpg",
      "https://example.com/animated.gif",
      "https://example.com/bag.jpeg",
    ],
  });

  const result = spawnSync(process.execPath, ["scripts/export-nis-meta.js", productsDir, templatePath, outputPath], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const exported = XLSX.readFile(outputPath);
  const exportedRows = XLSX.utils.sheet_to_json(exported.Sheets.template_data, { header: 1, defval: "" });
  assert.equal(exportedRows[9][0], "Bags & Luggage");
  assert.equal(exportedRows[9][1], "Handbag");
  assert.equal(exportedRows[9][2], "Clutch");
  assert.equal(exportedRows[9][3], "Rhinestone Bag, Silver");
  assert.equal(exportedRows[9][4], "1688-1002-SILVER");
  assert.equal(exportedRows[9][5], "Other");
  assert.equal(exportedRows[9][6], "Silver");
  assert.equal(exportedRows[9][7], "Polyester");
  assert.equal(exportedRows[9][8], "https://example.com/bag.jpeg");
  assert.equal(exportedRows[10][3], "Rhinestone Bag, Black");
  assert.equal(exportedRows[10][4], "1688-1002-BLACK");
});

test("export:nis-meta keeps only one row per partner sku", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-export-"));
  const productsDir = path.join(tempDir, "products");
  const firstProductDir = path.join(productsDir, "1003-first");
  const secondProductDir = path.join(productsDir, "1003-second");
  const templatePath = path.join(tempDir, "NIS.xlsx");
  const outputPath = path.join(tempDir, "configured-nis.xlsx");
  await mkdir(firstProductDir, { recursive: true });
  await mkdir(secondProductDir, { recursive: true });

  const rows = [
    ["Template metadata"],
    ["Template Name"],
    ["Locale"],
    ["Optional"],
    ["Template Type"],
    ["Dropdown"],
    ["Example"],
    ["Partner SKU Unique", "Product Title EN"],
    ["seller_sku", "product_title_en"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.writeFile(workbook, templatePath);

  for (const productDir of [firstProductDir, secondProductDir]) {
    await writeJson(path.join(productDir, "meta.json"), { productId: "1003", title: "Duplicate Bag" });
  }

  const result = spawnSync(process.execPath, ["scripts/export-nis-meta.js", productsDir, templatePath, outputPath], {
    cwd: rootDir,
    encoding: "utf8",
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const exported = XLSX.readFile(outputPath);
  const exportedRows = XLSX.utils.sheet_to_json(exported.Sheets.template_data, { header: 1, defval: "" });
  const dataRows = exportedRows.slice(9).filter((row) => row.some((value) => String(value).trim()));
  assert.equal(dataRows.length, 1);
  assert.equal(dataRows[0][0], "1688-1003");
});

test("publish:images writes a manifest from local product images", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "publish-images-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1004-bag");
  const manifestPath = path.join(tempDir, "image-manifest.json");
  await mkdir(productDir, { recursive: true });
  await writeFile(path.join(productDir, "001.jpg"), Buffer.from([0xff, 0xd8, 0xff, 0xd9]));
  await writeJson(path.join(productDir, "meta.json"), {
    productId: "1004",
    title: "Local Image Bag",
  });
  await writeJson(path.join(productDir, "noon-product-attributes.json"), {
    productIdentity: {
      partnerSku: "1688-1004",
      productImages: ["001.jpg"],
    },
  });

  const result = spawnSync(process.execPath, ["scripts/publish-images.js", productsDir, manifestPath, "--dry-run"], {
    cwd: rootDir,
    encoding: "utf8",
    env: { ...process.env, GOOGLE_DRIVE_FOLDER_NAME: "noon-tools" },
  });

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  assert.equal(manifest.storage, "local-dry-run");
  assert.equal(manifest.products["1688-1004"].images.length, 1);
  assert.equal(manifest.products["1688-1004"].images[0].source, "001.jpg");
  assert.match(manifest.products["1688-1004"].images[0].url, /^file:\/\//);
});

test("export:nis-meta uses image manifest urls when provided", async () => {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "nis-export-manifest-"));
  const productsDir = path.join(tempDir, "products");
  const productDir = path.join(productsDir, "1005-bag");
  const templatePath = path.join(tempDir, "NIS.xlsx");
  const outputPath = path.join(tempDir, "configured-nis.xlsx");
  const manifestPath = path.join(tempDir, "image-manifest.json");
  await mkdir(productDir, { recursive: true });

  const rows = [
    ["Template metadata"],
    ["Template Name"],
    ["Locale"],
    ["Optional"],
    ["Template Type"],
    ["Dropdown"],
    ["Example"],
    ["Partner SKU Unique", "Product Title EN", "Image URL 1", "Image URL 2"],
    ["seller_sku", "product_title_en", "image_url_1", "image_url_2"],
  ];
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), "template_data");
  XLSX.writeFile(workbook, templatePath);

  await writeJson(path.join(productDir, "meta.json"), {
    productId: "1005",
    title: "Manifest Image Bag",
    images: ["https://cbu01.alicdn.com/img/ibank/example.gif"],
  });
  await writeJson(manifestPath, {
    products: {
      "1688-1005": {
        images: [
          { url: "https://drive.google.com/uc?export=download&id=file-1" },
          { url: "https://drive.google.com/uc?export=download&id=file-2" },
        ],
      },
    },
  });

  const result = spawnSync(
    process.execPath,
    ["scripts/export-nis-meta.js", productsDir, templatePath, outputPath, "--image-manifest", manifestPath],
    {
      cwd: rootDir,
      encoding: "utf8",
    },
  );

  assert.equal(result.status, 0, result.stderr || result.stdout);
  const exported = XLSX.readFile(outputPath);
  const exportedRows = XLSX.utils.sheet_to_json(exported.Sheets.template_data, { header: 1, defval: "" });
  assert.equal(exportedRows[9][0], "1688-1005");
  assert.equal(exportedRows[9][2], "https://drive.google.com/uc?export=download&id=file-1");
  assert.equal(exportedRows[9][3], "https://drive.google.com/uc?export=download&id=file-2");
});

function writeJson(filePath, data) {
  return import("node:fs/promises").then(({ writeFile }) => writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8"));
}
