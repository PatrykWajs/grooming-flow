# -*- coding: utf-8 -*-
"""Build a Grooming Flow backup zip holding a labelled FIXTURE wardrobe, for
screenshots and manual testing through the app's own Restore action. Nothing
here is anyone's real wardrobe: the items are generic, the thumbnails are
coloured squares.

Usage: python3 scripts/make-fixture-backup.py OUT.zip [--lat 37.98 --lon 23.73 --name "Athens, Greece"]
"""
import argparse
import datetime as dt
import io
import json
import pathlib
import uuid
import zipfile

from PIL import Image, ImageDraw

ROOT = pathlib.Path(__file__).resolve().parent.parent
taxonomy = json.load(open(ROOT / "public/rules/taxonomy.json", encoding="utf-8"))
palette = json.load(open(ROOT / "public/rules/palette.json", encoding="utf-8"))

SUB = {s["id"]: (c["id"], s) for c in taxonomy["categories"] for s in c["subcategories"]}
HEX = {c["id"]: c.get("hex", "#888888") for c in palette["colours"]}

# (subcategory, colour, pattern, material, brand note)
FIXTURE = [
    ("dress-shirt", "white", "solid", "cotton"),
    ("dress-shirt", "light-blue", "solid", "cotton"),
    ("casual-shirt", "navy", "check", "cotton"),
    ("polo", "navy", "solid", "cotton"),
    ("polo", "white", "solid", "cotton"),
    ("t-shirt", "white", "solid", "cotton"),
    ("t-shirt", "charcoal", "solid", "cotton"),
    ("henley", "cream", "solid", "cotton"),
    ("sweater", "grey", "solid", "knit"),
    ("sweater", "navy", "solid", "wool"),
    ("cardigan", "beige", "solid", "knit"),
    ("blazer", "navy", "solid", "wool"),
    ("overshirt", "olive", "solid", "cotton"),
    ("trench", "beige", "solid", "cotton"),
    ("chinos", "beige", "solid", "cotton"),
    ("chinos", "navy", "solid", "cotton"),
    ("jeans", "denim", "solid", "denim"),
    ("jeans", "black", "solid", "denim"),
    ("dress-trousers", "grey", "solid", "wool"),
    ("dress-trousers", "charcoal", "solid", "wool"),
    ("loafers", "brown", "solid", "leather"),
    ("derbies-oxfords", "black", "solid", "leather"),
    ("sneakers", "white", "solid", "leather"),
    ("chelsea-boots", "dark-brown", "solid", "leather"),
    ("chukka-boots", "tan", "solid", "suede"),
    ("leather-dress", "brown", "solid", "leather"),
    ("leather-dress", "black", "solid", "leather"),
    ("leather-casual", "tan", "solid", "leather"),
    ("watch-dress", "black", "solid", "leather"),
    ("sunglasses", "black", "solid", "other"),
    ("scarf", "burgundy", "solid", "wool"),
]


def thumb_png(colour_hex: str, label: str) -> bytes:
    img = Image.new("RGBA", (256, 256), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    draw.rounded_rectangle((24, 24, 232, 232), radius=40, fill=colour_hex)
    draw.text((40, 110), label, fill="#ffffff" if colour_hex.lower() not in ("#ffffff", "#f5f5f5") else "#333333")
    out = io.BytesIO()
    img.save(out, format="PNG")
    return out.getvalue()


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("out")
    ap.add_argument("--lat", type=float, default=37.98)
    ap.add_argument("--lon", type=float, default=23.73)
    ap.add_argument("--name", default="Athens, Attica, Greece")
    args = ap.parse_args()

    today = dt.date.today()
    added = (today - dt.timedelta(days=40)).isoformat()
    items, blobs, files = [], [], {}
    for n, (sub, colour, pattern, material) in enumerate(FIXTURE):
        category, spec = SUB[sub]
        item_id = f"fixture-{n:02d}-{uuid.uuid4().hex[:8]}"
        blob_id = f"{item_id}-thumb"
        png = thumb_png(HEX.get(colour, "#888888"), sub)
        files[f"blobs/{blob_id}.png"] = png
        blobs.append({"id": blob_id, "mime": "image/png", "file": f"blobs/{blob_id}.png"})
        items.append(
            {
                "id": item_id,
                "category": category,
                "subcategory": sub,
                "colourPrimary": colour,
                "colourSecondary": None,
                "pattern": pattern,
                "material": material,
                "warmth": spec.get("warmth", 3),
                "formality": spec.get("formality", 3),
                "seasons": ["spring", "summer", "autumn", "winter"],
                "status": "active",
                "favourite": False,
                "brand": "fixture",
                "notes": "fixture item (not a real wardrobe)",
                "photoBlobId": blob_id,
                "thumbBlobId": blob_id,
                "phash": None,
                "embedding": None,
                "userEdited": [],
                "setId": None,
                "addedAt": added,
                "wearCount": 0,
                "lastWorn": None,
                "eligibleDays": 0,
                "wearsSinceWash": 0,
                "wearMore": 1,
            }
        )
    settings = {"id": "settings", "onboarded": True, "locationName": args.name, "lat": args.lat, "lon": args.lon, "persistGranted": None}
    data = {
        "app": "groomingflow",
        "version": 2,
        "exportedAt": dt.datetime.now(dt.timezone.utc).isoformat(),
        "items": items,
        "outfits": [],
        "moments": [],
        "wearEntries": [],
        "occasions": [],
        "settings": [settings],
        "preferences": [],
        "blobs": blobs,
    }
    with zipfile.ZipFile(args.out, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("data.json", json.dumps(data))
        for name, content in files.items():
            z.writestr(name, content, compress_type=zipfile.ZIP_STORED)
    print(f"wrote {args.out}: {len(items)} fixture items, {len(blobs)} thumbnails")


if __name__ == "__main__":
    main()
