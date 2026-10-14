"""Offline smoke test for the checked-in RapidOCR bridge."""

import base64
import io
import json
import subprocess
import sys
import urllib.request
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


def main():
    image = Image.new("RGB", (1000, 530), "white")
    draw = ImageDraw.Draw(image)
    font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 36)
    draw.text((25, 20), "属性加成", fill="black", font=font)
    draw.text((25, 90), "盾兵攻击力 1917.1%", fill="black", font=font)
    draw.text((25, 160), "矛兵数量 93,666", fill="black", font=font)
    draw.text((25, 240), "特殊加成说明", fill="black", font=font)
    draw.text((25, 310), "官职赐予部队攻击力 0%", fill="black", font=font)
    draw.text((25, 380), "敌方穿透力减益（专家技能） 5%", fill="black", font=font)
    stream = io.BytesIO()
    image.save(stream, format="PNG")
    request = {"mode": "reportAttributesAndSpecialBonuses", "images": [{"imageId": "中文战报.png", "dataBase64":
        base64.b64encode(stream.getvalue()).decode("ascii")}]}
    bridge = Path(__file__).with_name("local-ocr.py")
    if len(sys.argv) > 1:
        remote = urllib.request.Request(sys.argv[1],
                                        json.dumps(request).encode("utf-8"),
                                        {"Content-Type": "application/json"}, method="POST")
        with urllib.request.urlopen(remote, timeout=60) as response:
            parsed = json.load(response)["images"][0]
    else:
        result = subprocess.run([sys.executable, str(bridge)],
                                input=json.dumps(request).encode("utf-8"),
                                capture_output=True, check=True)
        parsed = json.loads(result.stdout)["images"][0]
    lines = parsed["lines"]
    enhanced_lines = parsed["enhancedLines"]
    assert parsed["imageId"] == "中文战报.png", parsed["imageId"]
    assert any("属性加成" in row["text"] for row in lines), lines
    assert any("攻击" in row["text"] for row in lines), lines
    assert any("1917" in row["text"] for row in lines), lines
    assert any("93,666" in row["text"] for row in lines), lines
    assert any("特殊加成" in row["text"] for row in lines), lines
    assert any("官职" in row["text"] and "0%" in row["text"] for row in lines), lines
    assert any("穿透" in row["text"] and "专家" in row["text"] for row in lines), lines
    assert all(len(row["box"]) == 4 and 0 <= row["confidence"] <= 1
               for row in lines), lines
    assert all(row["bbox"]["x2"] >= row["bbox"]["x1"] and
               row["bbox"]["y2"] >= row["bbox"]["y1"] for row in lines), lines
    assert any("1917" in row["text"] for row in enhanced_lines), enhanced_lines
    assert all(len(row["box"]) == 4 and 0 <= row["confidence"] <= 1
               for row in enhanced_lines), enhanced_lines
    Path("examples/ice-fire-local-ocr-smoke.json").write_text(json.dumps(parsed, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps({"recognized": lines, "enhanced": enhanced_lines},
                     ensure_ascii=True))


if __name__ == "__main__":
    main()
