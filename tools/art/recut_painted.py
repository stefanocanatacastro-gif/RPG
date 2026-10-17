"""Re-cuts a painted sprite sheet whose rows and columns drift onto the game's grid.

Each row is anchored on its own floor line. Each frame's left and right edges
are found per row: the row is split into its frame count at the narrowest gaps
in the drawing (near where an even split would put them), so frames joined by
slash effects or stars are still cut between the figures. Every frame is put
through the same square window (feet on the bottom, column centred), scaled to
the game's frame size and reduced to 256 colours.

Usage:
  python3 tools/art/recut_painted.py SRC OUT --frame 96 \\
      --bands 0:196,202:392,395:581,592:761,774:907,911:1085 --counts 6,8,8,4,6,6

--bands are each row's top and floor (its feet) in the source, --counts the
frames in each row. --window sets the square taken around each frame (default:
the widest frame or tallest row, whichever is bigger).
"""
import argparse
from PIL import Image

ap = argparse.ArgumentParser()
ap.add_argument("src")
ap.add_argument("out")
ap.add_argument("--frame", type=int, default=96)
ap.add_argument("--bands", required=True)
ap.add_argument("--counts", required=True)
ap.add_argument("--window", type=int, default=0)
ap.add_argument("--search", type=int, default=40, help="how far from an even split a cut may move")
ap.add_argument("--haze", type=int, default=24, help="alpha below this becomes see-through")
args = ap.parse_args()

im = Image.open(args.src).convert("RGBA")
alpha = im.getchannel("A").point(lambda v: 255 if v > 60 else 0)
apx = alpha.load()
F = args.frame
bands = [tuple(int(v) for v in b.split(":")) for b in args.bands.split(",")]
counts = [int(c) for c in args.counts.split(",")]


def edges(top, floor, n):
    """The n+1 x positions between this row's frames."""
    col = [sum(1 for y in range(top, floor + 1) if apx[x, y]) for x in range(im.width)]
    drawn = [x for x, v in enumerate(col) if v > 1]
    x0, x1 = drawn[0], drawn[-1] + 1
    out = [x0]
    for k in range(1, n):
        guess = out[-1] + (x1 - out[-1]) / (n - k + 1)
        lo, hi = int(guess - args.search), int(guess + args.search)
        best = min(range(max(out[-1] + 20, lo), min(x1 - 20, hi)), key=lambda x: (col[x], abs(x - guess)))
        out.append(best)
    out.append(x1)
    return out


rows = [(top, floor, edges(top, floor, n)) for (top, floor), n in zip(bands, counts)]
widest = max(e[i + 1] - e[i] for _, _, e in rows for i in range(len(e) - 1))
tallest = max(floor - top + 1 for top, floor, _ in rows)
Wn = args.window or max(widest, tallest)
cols = max(8, max(counts))
sheet = Image.new("RGBA", (F * cols, F * len(bands)), (0, 0, 0, 0))
for r, (top, floor, e) in enumerate(rows):
    print(f"row {r}: floor {floor}, frames at {e}")
    for c in range(len(e) - 1):
        x0, x1 = e[c], e[c + 1]
        part = im.crop((x0, max(top, floor + 1 - Wn), x1, floor + 1))
        cell = Image.new("RGBA", (Wn, Wn), (0, 0, 0, 0))
        cell.alpha_composite(part, ((Wn - part.width) // 2, Wn - part.height))
        small = cell.convert("RGBa").resize((F, F), Image.LANCZOS).convert("RGBA")
        small.putalpha(small.getchannel("A").point(lambda v: 0 if v < args.haze else v))
        sheet.alpha_composite(small, (c * F, r * F))
sheet.quantize(colors=256, method=Image.Quantize.FASTOCTREE, dither=Image.Dither.NONE).save(args.out, optimize=True)
print("wrote", args.out, sheet.size, "window", Wn)
