#!/usr/bin/env python3

import argparse
import json
from pathlib import Path


def main():
    parser = argparse.ArgumentParser(description="Assign local product images to noon variants.")
    parser.add_argument("product_dir", help="Product directory containing noon-product-attributes.json")
    parser.add_argument("--mapping", required=True, help="JSON mapping from partner_sku/colour_name/colour to image paths")
    parser.add_argument("--output", help="Optional output JSON path. Defaults to overwriting noon-product-attributes.json")
    args = parser.parse_args()

    product_dir = Path(args.product_dir)
    product_path = product_dir / "noon-product-attributes.json"
    output_path = Path(args.output) if args.output else product_path
    mapping = json.loads(Path(args.mapping).read_text(encoding="utf-8"))
    product = json.loads(product_path.read_text(encoding="utf-8"))
    variants = product.get("variants") or []
    changed = 0

    for variant in variants:
        key = first_present(
            variant.get("partner_sku"),
            variant.get("colour_name"),
            variant.get("colour"),
        )
        images = find_mapping_images(mapping, variant)
        if images is None:
            continue

        normalized_images = [normalize_image_path(image) for image in images]
        missing = [image for image in normalized_images if not (product_dir / image).exists()]
        if missing:
            raise SystemExit(f"{key}: missing image(s): {', '.join(missing)}")

        variant["images"] = normalized_images
        changed += 1
        print(f"{key}: {len(normalized_images)} image(s)")

    output_path.write_text(json.dumps(product, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"updated {changed} variant(s): {output_path}")


def find_mapping_images(mapping, variant):
    for key in (variant.get("partner_sku"), variant.get("colour_name"), variant.get("colour")):
        if key and key in mapping:
            return mapping[key]
    return None


def normalize_image_path(image):
    text = str(image).strip().replace("\\", "/")
    return text if text.startswith("images/") else f"images/{Path(text).name}"


def first_present(*values):
    for value in values:
        if value:
            return str(value)
    return "(unknown)"


if __name__ == "__main__":
    main()
