"""Measure two local HTTP OCR requests with the same synthetic Chinese image."""
import base64
import io
import json
import sys
import time
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    if len(sys.argv) != 2:
        raise SystemExit("Usage: python scripts/profile-local-ocr.py http://127.0.0.1:5173")
    url = sys.argv[1].rstrip("/")
    image = Image.new("RGB", (900, 240), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 36)
    for y, text in [(20, "属性加成"), (90, "盾兵攻击力 1917.1%"),
                    (160, "矛兵数量 93,666")]:
        draw.text((25, y), text, fill="black", font=font)
    buffer = io.BytesIO()
    image.save(buffer, format="PNG")
    fixture = Path(".tmp/ocr-startup-fixture.png")
    fixture.parent.mkdir(exist_ok=True)
    fixture.write_bytes(buffer.getvalue())
    body = json.dumps({"images": [{"imageId": "startup-profile.png",
        "dataBase64": base64.b64encode(buffer.getvalue()).decode("ascii")}]}).encode("utf-8")
    with urllib.request.urlopen(url + "/__pvp/ocr-status") as response:
        before = json.load(response)
    results = []
    for number in [1, 2]:
        started = time.perf_counter()
        request = urllib.request.Request(url + "/api/local-ocr", body,
            {"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(request, timeout=120) as response:
            result = json.load(response)
        assert any("1917" in row["text"] for row in result["images"][0]["lines"])
        results.append({"request": number,
            "httpMs": (time.perf_counter() - started) * 1000,
            **result["performance"]})
    with urllib.request.urlopen(url + "/__pvp/ocr-status") as response:
        after = json.load(response)
    assert after["workerStarts"] == before["workerStarts"] + (0 if before["started"] else 1)
    assert results[1]["engineReused"] is True
    print(json.dumps({"url": url, "fixture": "900x240 synthetic Chinese image",
        "before": before, "results": results, "after": after}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
