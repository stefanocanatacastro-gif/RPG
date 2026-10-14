"""Guide sheets for drawing fighters in Pixelorama (or any editor).

Import one as a reference layer, draw on the layers above it, and hide it before
exporting. One row per animation, in the order the game reads them.
Usage: python3 tools/make_templates.py art/templates
"""
import os, sys
from PIL import Image, ImageDraw

out = sys.argv[1] if len(sys.argv) > 1 else "art/templates"
os.makedirs(out, exist_ok=True)
ROWS = [("IDLE", "4 frames, loops"), ("WALK", "6-8 frames, loops"), ("ATTACK", "4-6 frames"),
        ("HURT", "2-3 frames"), ("KNOCKED OUT", "4 frames, last one held"), ("VICTORY", "4 frames, last one held")]
COLS = 8
# size class -> frame size, and how tall Kid Chispa stands for comparison
SIZES = {"normal": (96, 87), "big": (144, 87), "huge": (240, 87)}

def tag(d, x, y, lines):
    """Labels on a dark box, readable on any canvas."""
    w = max(d.textlength(l) for l in lines) + 6
    d.rectangle([x, y, x + w, y + 11 * len(lines) + 3], fill=(20, 16, 28, 200))
    for i, l in enumerate(lines):
        d.text((x + 3, y + 2 + 11 * i), l, fill=(255, 230, 140, 255) if i == 0 else (225, 220, 235, 255))


for name, (S, chispa) in SIZES.items():
    im = Image.new("RGBA", (COLS * S, len(ROWS) * S), (0, 0, 0, 0))
    d = ImageDraw.Draw(im)
    for r, (label, hint) in enumerate(ROWS):
        for c in range(COLS):
            x, y = c * S, r * S
            # cell border
            d.rectangle([x, y, x + S - 1, y + S - 1], outline=(120, 110, 140, 150))
            # floor: feet stand on the bottom row of pixels
            d.line([x, y + S - 1, x + S - 1, y + S - 1], fill=(255, 90, 110, 230))
            # centre line: keep the body centred on it so frames don't jitter
            for yy in range(y, y + S, 4):
                d.line([x + S // 2, yy, x + S // 2, yy + 1], fill=(90, 170, 255, 170))
            # Kid Chispa's height, for scale
            hy = y + S - chispa
            for xx in range(x, x + S, 6):
                d.line([xx, hy, xx + 2, hy], fill=(240, 200, 80, 170))
        tag(d, 2, r * S + 2, [label, hint])
    tag(d, S + 2, 2, [f"{name.upper()} {S}x{S}", "yellow: Chispa height", "red: floor", "blue: centre"])
    im.save(os.path.join(out, f"template_{name}_{S}.png"))
    print("wrote", name, im.size)
