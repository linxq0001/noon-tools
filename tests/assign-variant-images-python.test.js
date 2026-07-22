import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const rootDir = path.resolve(import.meta.dirname, "..");

test("python variant image assignment writes images by sku and colour", async () => {
  const productDir = await mkdtemp(path.join(os.tmpdir(), "variant-images-python-"));
  await mkdir(path.join(productDir, "images"));
  await writeFile(path.join(productDir, "images", "001.jpg"), "");
  await writeFile(path.join(productDir, "images", "002.jpg"), "");
  await writeFile(
    path.join(productDir, "noon-product-attributes.json"),
    JSON.stringify(
      {
        variants: [
          { partner_sku: "SKU-SILVER", colour: "Silver", colour_name: "Silver", images: [] },
          { partner_sku: "SKU-PINK", colour: "Pink", colour_name: "Pink", images: [] },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    path.join(productDir, "mapping.json"),
    JSON.stringify({
      "SKU-SILVER": ["images/001.jpg"],
      Pink: ["images/002.jpg"],
    }),
  );

  await execFileAsync("python3", ["scripts/assign-variant-images.py", productDir, "--mapping", path.join(productDir, "mapping.json")], {
    cwd: rootDir,
  });

  const product = JSON.parse(await readFile(path.join(productDir, "noon-product-attributes.json"), "utf8"));
  assert.deepEqual(product.variants[0].images, ["images/001.jpg"]);
  assert.deepEqual(product.variants[1].images, ["images/002.jpg"]);
});
