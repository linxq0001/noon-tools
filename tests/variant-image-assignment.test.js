import assert from "node:assert/strict";
import test from "node:test";
import { assignImagesToVariants } from "../scripts/lib/variant-image-assignment.js";

test("variant image assignment uses colour matches and shared fallback", () => {
  const result = assignImagesToVariants({
    colours: ["粉色", "黑色"],
    images: [
      { path: "001.jpg", nearText: "粉色 Pink" },
      { path: "002.jpg", nearText: "black bag" },
      { path: "003.jpg", nearText: "尺寸 17 x 6 x 15 cm" },
    ],
  });

  assert.deepEqual(
    result.imagesByColour["粉色"].map((image) => image.path),
    ["001.jpg", "003.jpg"],
  );
  assert.deepEqual(
    result.imagesByColour["黑色"].map((image) => image.path),
    ["002.jpg", "003.jpg"],
  );
});

test("variant image assignment accepts visual assignments but does not create new colours", () => {
  const result = assignImagesToVariants({
    colours: ["金色"],
    images: [
      { path: "001.jpg" },
      { path: "002.jpg" },
    ],
    visualAssignments: [
      { path: "001.jpg", assignedColour: "金色" },
      { path: "002.jpg", assignedColour: "蓝色" },
    ],
  });

  assert.deepEqual(
    result.imagesByColour["金色"].map((image) => image.path),
    ["001.jpg", "002.jpg"],
  );
  assert.match(result.warnings.join(" "), /Only 2 image/);
});
