"""Synthetic card image for the local OCR integration check (not a game screenshot)."""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

root = Path(__file__).resolve().parent.parent
image = Image.new("RGB", (1440, 520), "#183549")
draw = ImageDraw.Draw(image)
level_font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 32)
count_font = ImageFont.truetype(r"C:\Windows\Fonts\msyh.ttc", 28)
levels = ["11.0", "10.3", "11.4", "11.5", "11.4", "11.4"]
fire_crystals = [9, 8, 9, 10, 10, 10]
counts = [741805, 64035, 886378, 4659053, 3616209, 3149491]
for index, (level, count) in enumerate(zip(levels, counts)):
    x = 130 + index * 230
    draw.rounded_rectangle((x - 106, 85, x + 106, 350), 10,
                           fill="#234b65", outline="#7893a8", width=2)
    draw.rounded_rectangle((x - 70, 130, x + 70, 210), 8, fill="#397d9b")
    draw.ellipse((x + 40, 75, x + 104, 129), fill="#c55b45")
    for text, y, font in ((str(fire_crystals[index]), 78, level_font), (level, 220, level_font),
                          (f"{count:,}", 290, count_font)):
        box = draw.textbbox((0, 0), text, font=font)
        draw.text((x + (72 if y == 78 else 0) - (box[2] - box[0]) / 2, y), text, font=font,
                  fill="white", stroke_width=1, stroke_fill="#101e2a")
target = root / "examples" / "ocr-card-regression.png"
image.save(target)
print(target)
