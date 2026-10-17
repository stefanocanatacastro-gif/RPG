"""Re-cuts Kid Chispa's painted sheet (art/sprites/kid_chispa_v3_source.png, 1448x1086) onto the
game's grid: each row anchored on its own floor line, frames clipped to their 181-px column, scaled
to 96x96 cells (one row per animation), then reduced to 256 colours.

Usage: python3 tools/art/recut_kid_chispa.py art/sprites/kid_chispa_v3_source.png art/sprites/kid_chispa.png
"""
import sys
from PIL import Image
src, out = sys.argv[1], sys.argv[2]
im = Image.open(src).convert("RGBA")
P = 181          # source column pitch
F = 96           # game frame
BANDS = [(18, 186), (195, 370), (376, 549), (563, 732), (745, 890), (902, 1075)]  # top, floor of each row
COUNTS = [6, 8, 8, 4, 6, 6]
sheet = Image.new("RGBA", (F * 8, F * 6), (0, 0, 0, 0))
for r, ((top, floor), n) in enumerate(zip(BANDS, COUNTS)):
    for c in range(n):
        cell = Image.new("RGBA", (P, P), (0, 0, 0, 0))
        y0 = floor + 1 - P
        part = im.crop((c * P, max(top, y0), c * P + P, floor + 1))
        cell.alpha_composite(part, (0, P - part.height))
        small = cell.convert("RGBa").resize((F, F), Image.LANCZOS).convert("RGBA")
        # drop the faintest haze so empty space stays empty
        a = small.getchannel("A").point(lambda v: 0 if v < 24 else v)
        small.putalpha(a)
        sheet.alpha_composite(small, (c * F, r * F))
sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(out, optimize=True)
print("wrote", out, sheet.size)
