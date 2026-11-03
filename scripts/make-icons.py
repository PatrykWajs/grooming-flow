# -*- coding: utf-8 -*-
"""Generate the GF monogram icons (PNG) for the PWA manifest.

Run from the repo root:  python3 scripts/make-icons.py
Outputs public/icons/icon-192.png, icon-512.png, icon-512-maskable.png, apple-touch-icon.png
"""
import pathlib
import sys

from PIL import Image, ImageDraw, ImageFont

OLIVE = (0x5A, 0x6B, 0x4D)
PAPER = (0xF4, 0xF0, 0xE8)
OUT = pathlib.Path(__file__).resolve().parent.parent / "public" / "icons"
FONT_CANDIDATES = [
    "/System/Library/Fonts/Supplemental/Georgia Bold.ttf",
    "/System/Library/Fonts/Supplemental/Times New Roman Bold.ttf",
    "/Library/Fonts/Georgia Bold.ttf",
]


def font(size: int) -> ImageFont.FreeTypeFont:
    for path in FONT_CANDIDATES:
        if pathlib.Path(path).exists():
            return ImageFont.truetype(path, size)
    return ImageFont.load_default(size)


def monogram(size: int, maskable: bool) -> Image.Image:
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    if maskable:
        draw.rectangle((0, 0, size, size), fill=OLIVE)
        glyph_box = 0.44
    else:
        radius = int(size * 0.22)
        draw.rounded_rectangle((0, 0, size - 1, size - 1), radius=radius, fill=OLIVE)
        glyph_box = 0.52
    f = font(int(size * glyph_box))
    text = "GF"
    bbox = draw.textbbox((0, 0), text, font=f)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - w) / 2 - bbox[0]
    y = (size - h) / 2 - bbox[1]
    draw.text((x, y), text, font=f, fill=PAPER)
    return img


def main() -> int:
    OUT.mkdir(parents=True, exist_ok=True)
    monogram(192, False).save(OUT / "icon-192.png")
    monogram(512, False).save(OUT / "icon-512.png")
    monogram(512, True).save(OUT / "icon-512-maskable.png")
    touch = monogram(180, False).convert("RGB")
    touch.save(OUT / "apple-touch-icon.png")
    for p in sorted(OUT.glob("*.png")):
        im = Image.open(p)
        print(f"{p.name}: {im.size[0]}x{im.size[1]} {im.mode} {p.stat().st_size} bytes")
    return 0


if __name__ == "__main__":
    sys.exit(main())
