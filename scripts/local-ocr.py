"""Local, full-image Chinese OCR bridge. Reads one JSON request from stdin."""

import base64
import contextlib
import io
import json
import sys
import time

import numpy as np
from PIL import Image, ImageEnhance, ImageFilter
from rapidocr import RapidOCR

sys.stdout.reconfigure(encoding="utf-8")
sys.stderr.reconfigure(encoding="utf-8")
sys.stdin.reconfigure(encoding="utf-8")


engine = None


def recognize(request):
    global engine
    if request.get("mode") not in (None, "attributes", "reportAttributesAndSpecialBonuses"):
        raise ValueError("OCR supports report attributes and special bonuses; troop inference is disabled")
    started = time.perf_counter()
    images = request.get("images", [])
    if not isinstance(images, list) or not 1 <= len(images) <= 8:
        raise ValueError("Expected one to eight images")
    reused = engine is not None
    initialized = time.perf_counter()
    if engine is None:
        with contextlib.redirect_stdout(sys.stderr):
            engine = RapidOCR()
    init_ms = (time.perf_counter() - initialized) * 1000
    output = []
    for item in images:
        raw = base64.b64decode(item["dataBase64"], validate=True)
        if len(raw) > 10 * 1024 * 1024:
            raise ValueError("Image exceeds 10 MB")
        with Image.open(io.BytesIO(raw)) as source:
            image = source.convert("RGB")
            width, height = image.size
            if width * height > 25_000_000:
                raise ValueError("Image exceeds 25 megapixels")
            pixels = np.asarray(image)
        def read_lines(source, scale=1, offset=(0, 0)):
            with contextlib.redirect_stdout(sys.stderr):
                result = engine(source)
            boxes = result.boxes if result.boxes is not None else []
            texts = result.txts if result.txts is not None else []
            scores = result.scores if result.scores is not None else []
            lines = []
            for box, text, score in zip(boxes, texts, scores):
                points = [[float(x) / scale + offset[0], float(y) / scale + offset[1]]
                          for x, y in box]
                lines.append({"text": str(text), "confidence": float(score),
                              "box": points,
                              "bbox": {"x1": min(point[0] for point in points),
                                       "y1": min(point[1] for point in points),
                                       "x2": max(point[0] for point in points),
                                       "y2": max(point[1] for point in points)}})
            return lines
        lines = read_lines(pixels)
        scale = 2 if width * height <= 6_000_000 else 1
        enhanced = image.resize((width * scale, height * scale)) if scale > 1 else image
        enhanced = ImageEnhance.Contrast(enhanced.convert("L")).enhance(1.8)
        enhanced = enhanced.filter(ImageFilter.UnsharpMask(radius=1.4, percent=150))
        enhanced_lines = read_lines(np.asarray(enhanced.convert("RGB")), scale)
        output.append({"imageId": item["imageId"], "width": width,
                       "height": height, "lines": lines,
                       "enhancedLines": enhanced_lines})
    return {"images": output, "performance": {
        "engineReused": reused, "modelInitializationMs": init_ms,
        "workerRequestMs": (time.perf_counter() - started) * 1000,
    }}


def main():
    if "--worker" in sys.argv:
        for line in sys.stdin:
            try:
                result = recognize(json.loads(line))
            except Exception as error:
                result = {"error": str(error)}
            print(json.dumps(result, ensure_ascii=False), flush=True)
    else:
        json.dump(recognize(json.load(sys.stdin)), sys.stdout, ensure_ascii=False)


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        json.dump({"error": str(error)}, sys.stdout, ensure_ascii=False)
        sys.exit(1)
