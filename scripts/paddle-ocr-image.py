#!/usr/bin/env python3

import json
import re
import sys
import tempfile
from contextlib import redirect_stdout
from pathlib import Path


def build_ocr():
    from paddleocr import PaddleOCR

    try:
        return PaddleOCR(use_textline_orientation=True, lang="en")
    except ValueError:
        return PaddleOCR(use_angle_cls=True, lang="en")


def flatten_texts(result):
    texts = []

    def visit(value):
        if hasattr(value, "json") and isinstance(value.json, dict):
            visit(value.json)
        if isinstance(value, dict):
            if isinstance(value.get("rec_texts"), list):
                texts.extend(str(item) for item in value["rec_texts"] if item)
            elif value.get("text"):
                texts.append(str(value["text"]))
            else:
                for item in value.values():
                    visit(item)
        elif isinstance(value, (list, tuple)):
            if len(value) == 2 and isinstance(value[1], (list, tuple)) and value[1] and isinstance(value[1][0], str):
                texts.append(str(value[1][0]))
            else:
                for item in value:
                    visit(item)

    visit(result)
    return texts


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"ok": False, "error": "Usage: paddle-ocr-image.py <image-path> [image-path...]"}))
        return 2

    image_paths = sys.argv[1:]
    temp_paths = []

    try:
        with redirect_stdout(sys.stderr):
            ocr = build_ocr()
            results = []
            for image_path in image_paths:
                image_results = [run_ocr(ocr, image_path)]
                texts = unique_texts(flatten_texts(image_results))

                if not has_complete_dimensions(texts) and has_dimension_text(texts):
                    candidate_paths = build_auxiliary_image_candidates(image_path)
                    temp_paths.extend(candidate_paths)
                    for candidate_path in candidate_paths:
                        image_results.append(run_ocr(ocr, candidate_path))
                    texts = unique_texts(flatten_texts(image_results))

                results.append({"imagePath": image_path, "texts": texts})

                if has_complete_dimensions(texts):
                    break
        response = {"ok": True, "results": results}
        if len(results) == 1:
            response["texts"] = results[0]["texts"]
        print(json.dumps(response, ensure_ascii=False))
        return 0
    except Exception as exc:
        print(json.dumps({"ok": False, "error": str(exc)}, ensure_ascii=False))
        return 0
    finally:
        for temp_path in temp_paths:
            Path(temp_path).unlink(missing_ok=True)


def run_ocr(ocr, image_path):
    if hasattr(ocr, "predict"):
        return ocr.predict(image_path)
    return ocr.ocr(image_path, cls=True)


def build_auxiliary_image_candidates(image_path):
    paths = []

    try:
        from PIL import Image
    except Exception:
        return paths

    source = Path(image_path)
    with Image.open(source) as image:
        width, height = image.size
        left_text_region = image.crop((0, int(height * 0.25), int(width * 0.35), int(height * 0.85)))
        paths.append(save_temp_image(left_text_region.rotate(90, expand=True, fillcolor="white"), source.suffix))

        bottom_text_region = image.crop((0, int(height * 0.62), width, height))
        bottom_text_region = bottom_text_region.resize((bottom_text_region.width * 2, bottom_text_region.height * 2))
        paths.append(save_temp_image(bottom_text_region, source.suffix))

    return paths


def has_dimension_text(texts):
    return bool(re.search(r"\d\s*(?:c\s*m?|in)\b", "\n".join(texts), re.IGNORECASE))


def has_complete_dimensions(texts):
    text = "\n".join(texts)
    centimeters = [float(value.replace(",", ".")) for value in re.findall(r"(\d+(?:[.,]\d+)?)\s*c\s*m?\b", text, re.IGNORECASE)]
    inches = [float(value.replace(",", ".")) * 2.54 for value in re.findall(r"(\d+[.,]\d+)\s*(?:i\s*)?in\b", text, re.IGNORECASE)]
    numbers = sorted({round(number, 1) for number in [*centimeters, *inches] if 0 < number <= 80})

    if len(numbers) >= 4 and max(numbers) >= 40:
        numbers = [number for number in numbers if number < 40]

    return len(numbers) >= 3


def save_temp_image(image, suffix):
    temp = tempfile.NamedTemporaryFile(prefix="noon-paddleocr-", suffix=suffix or ".jpg", delete=False)
    temp.close()
    image.save(temp.name)
    return temp.name


def unique_texts(texts):
    seen = set()
    output = []

    for text in texts:
        key = " ".join(str(text).split())
        if not key or key in seen:
            continue
        seen.add(key)
        output.append(key)

    return output


if __name__ == "__main__":
    raise SystemExit(main())
