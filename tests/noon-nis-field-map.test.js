import assert from "node:assert/strict";
import test from "node:test";
import {
  constraintValuesForNisField,
  noonNisFieldMapByPageLabel,
  noonNisFieldMapByPath,
} from "../scripts/lib/noon-nis-field-map.js";

test("noon field map links page labels to NIS template fields and constraints", () => {
  const features = noonNisFieldMapByPageLabel.get("Features");
  assert.equal(features.noonPath, "product_group.features[]");
  assert.equal(features.nisCode, "bags_luggage_feature_1-5");
  assert.equal(features.kind, "select-array");
  assert.ok(constraintValuesForNisField(features).includes("Lightweight"));

  const type = noonNisFieldMapByPageLabel.get("Type");
  assert.equal(type.nisHeader, "Clutch Type");
  assert.equal(type.nisCode, "clutch_type");
  assert.ok(constraintValuesForNisField(type).includes("Envelope"));

  const width = noonNisFieldMapByPath.get("variants[].width_cm");
  assert.equal(width.nisHeader, "Product Width/Depth / Product Width_Depth Unit");
  assert.equal(width.unitValue, "Centimeter");

  const weight = noonNisFieldMapByPath.get("variants[].actual_weight_kg");
  assert.equal(weight.nisCode, "product_weight / product_weight_unit");
  assert.equal(weight.unitValue, "Kilogram");
});
