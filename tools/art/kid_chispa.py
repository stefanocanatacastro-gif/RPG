"""Kid Chispa, finished-style sprite sheet (96x96 frames, one row per animation).

The hero is built from body parts posed on a skeleton, then shaded and
outlined pixel by pixel like hand-made pixel art: four tones per material lit
from the upper left, a selective outline, and dark lines where a part passes in
front of another. Every pixel is decided at 1:1, nothing is scaled.

Rows: idle (4), walk (8), attack (6), hurt (3), knocked out (4), victory (4).
Usage: python3 tools/art/kid_chispa.py art/sprites/kid_chispa.png
"""
import math, sys
from PIL import Image

S = 96
COLS = 8
FLOOR = S - 1  # feet stand on the last row of pixels

# ── palette: highlight, base, shade, deep ───────────────────────────────
def hx(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)

PAL = {
    "skin": [hx("#f8cfa0"), hx("#e3a274"), hx("#bd7650"), hx("#8c5036")],
    "mask": [hx("#ffe486"), hx("#f6b93b"), hx("#d98a1d"), hx("#a35f13")],
    "blue": [hx("#6fb0ff"), hx("#3576e8"), hx("#2349b0"), hx("#172f78")],
    "red": [hx("#ff7a72"), hx("#e2343f"), hx("#aa2131"), hx("#6f1522")],
    "white": [hx("#ffffff"), hx("#ece8f4"), hx("#bdb4cf"), hx("#857c99")],
    "bolt": [hx("#fff6a8"), hx("#ffdc3c"), hx("#e7a91f"), hx("#b07415")],
    "dark": [hx("#4a3f5c"), hx("#2e2640"), hx("#221c30"), hx("#17121f")],
    "tape": [hx("#ffffff"), hx("#f1eee6"), hx("#c9c2b4"), hx("#8f8778")],
}
OUTLINE = hx("#1a1424")
EYE = hx("#ffffff")
PUPIL = hx("#1a1424")

# ── geometry helpers ────────────────────────────────────────────────────
def rot(x, y, a):
    c, s = math.cos(a), math.sin(a)
    return x * c - y * s, x * s + y * c

def seg_dist(px, py, ax, ay, bx, by):
    """Distance from p to segment ab, and how far along it (0..1)."""
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    qx, qy = ax + dx * t, ay + dy * t
    return math.hypot(px - qx, py - qy), t

def in_poly(px, py, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            xi = x1 + (py - y1) * (x2 - x1) / (y2 - y1)
            if px < xi:
                inside = not inside
    return inside


class Part:
    """A body part: a shape test, a material function, and a depth."""

    def __init__(self, name, z, inside, material, light=3.0, rim=1.4):
        self.name, self.z, self.inside, self.material = name, z, inside, material
        self.light, self.rim = light, rim


def capsule(a, b, r1, r2):
    def inside(x, y):
        d, t = seg_dist(x, y, *a, *b)
        return d <= r1 + (r2 - r1) * t
    return inside


def along(a, b):
    """Position along a limb (0 at a, 1 at b) and across it (signed, in pixels)."""
    def f(x, y):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1e-9
        t = ((x - a[0]) * dx + (y - a[1]) * dy) / (L * L)
        s = ((x - a[0]) * -dy + (y - a[1]) * dx) / L
        return t, s
    return f


def ik(root, target, l1, l2, bend):
    """Two-bone IK: the middle joint, bending to one side (+1 / -1)."""
    dx, dy = target[0] - root[0], target[1] - root[1]
    d = min(math.hypot(dx, dy), l1 + l2 - 0.01)
    d = max(d, abs(l1 - l2) + 0.01)
    a = math.atan2(dy, dx)
    cosb = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d)
    b = math.acos(max(-1, min(1, cosb)))
    ang = a + bend * b
    return root[0] + math.cos(ang) * l1, root[1] + math.sin(ang) * l1


# ── the pose → parts ────────────────────────────────────────────────────
TH, SH = 14.5, 15.0      # thigh, shin
UA, FA = 12.0, 11.0      # upper arm, forearm
TORSO = 24.0
HR = 1.32                # head scale (the mask is drawn on an 11.6 x 12.2 oval, then scaled)


def build(p):
    """Parts for a pose. p: dict of joint targets and angles (see POSES)."""
    parts = []
    hip = (48 + p.get("hx", 0), FLOOR - 3 - (TH + SH) * 0.95 + p.get("hy", 0))
    lean = p.get("lean", 0.0)  # radians, + leans forward (to the right)
    up = rot(0, -TORSO, lean)
    neck = (hip[0] + up[0], hip[1] + up[1])
    # shoulders: across the torso top (3/4 view, the front one nearer the viewer)
    acr = rot(1, 0, lean)
    sh_front = (neck[0] + acr[0] * 10 + 1, neck[1] + acr[1] * 10 + 5)
    sh_back = (neck[0] - acr[0] * 8.5, neck[1] - acr[1] * 8.5 + 5)

    # legs (feet targets are absolute)
    def leg(side, foot, z, bend=-1):
        root = (hip[0] + (6.5 if side == "front" else -6.5) * acr[0], hip[1] + 1)
        knee = ik(root, foot, TH, SH, bend)
        dim = 0 if side == "front" else 1  # the back leg is a step darker
        th = along(root, knee)
        sh = along(knee, foot)

        def thigh_mat(x, y):
            t, s = th(x, y)
            return ("blue", dim) if t < 0.38 else ("skin", dim)

        def shin_mat(x, y):
            t, s = sh(x, y)
            if t < 0.18:
                return ("white", dim)  # knee pad
            if t < 0.42:
                return ("skin", dim)
            if t < 0.52:
                return ("red", dim)  # boot top band
            if 0.6 < t < 0.95 and abs(s) < 1.2:
                return ("red", dim)  # laces
            return ("white", dim)

        parts.append(Part(f"thigh_{side}", z, capsule(root, knee, 7.6, 6.2), thigh_mat))
        parts.append(Part(f"shin_{side}", z + 0.1, capsule(knee, foot, 6.2, 6.8), shin_mat))
        # boot foot, pointing the way the fighter faces (or as posed)
        fa = p.get(f"foot_{side}_ang", 0.0)
        toe = (foot[0] + math.cos(fa) * 9.5, foot[1] + math.sin(fa) * 9.5 - 0.5)
        heel = (foot[0] - math.cos(fa) * 3, foot[1] - math.sin(fa) * 3)
        def foot_mat(x, y):
            t, s = along(heel, toe)(x, y)
            return ("dark", 1) if s > 2.4 else ("white", dim)  # sole
        parts.append(Part(f"foot_{side}", z + 0.2, capsule(heel, toe, 5.6, 4.6), foot_mat))
        return knee

    leg("back", (hip[0] + p.get("fbx", -6), FLOOR - 3 + p.get("fby", 0)), 1, p.get("bend_back", -1))
    leg("front", (hip[0] + p.get("ffx", 7), FLOOR - 3 + p.get("ffy", 0)), 4, p.get("bend_front", -1))

    # torso: wider at the chest, a singlet over it
    tp = [(-12, 0), (-13.5, -9), (-15, -18), (-13.5, -24), (14, -24), (15.5, -18), (13.5, -9), (12, 0)]
    tpts = []
    for x, y in tp:
        rx, ry = rot(x, y + 2, lean)
        tpts.append((hip[0] + rx, hip[1] + ry))
    def torso_mat(x, y):
        lx, ly = rot(x - hip[0], y - hip[1], -lean)
        ly -= 2
        if ly > -5:
            if ly < -1.8:
                return ("bolt", 0) if -1.5 < lx < 3 else ("red", 0)  # belt and buckle
            return ("blue", 0)  # trunks
        # a scoop neck, and bare shoulders past the singlet's straps
        if ly < -16.5 and ((lx - 1) / 6.5) ** 2 + ((ly + 26) / 8.5) ** 2 <= 1:
            return ("skin", 0)
        if ly < -18 and (lx < -8.5 or lx > 9.5):
            return ("skin", 0)
        # lightning bolt across the chest
        bolt = [(-1, -16), (6, -16), (2.5, -11), (7, -11), (-3, -3.5), (0.5, -9), (-4, -9)]
        if in_poly(lx, ly, bolt):
            return ("bolt", 0)
        return ("blue", 0)
    parts.append(Part("torso", 3, lambda x, y: in_poly(x, y, tpts), torso_mat, light=4.5))

    # head: a luchador mask, 3/4 view facing right
    ha = lean + p.get("tilt", 0)
    hoff = rot(2, -13.5, ha)
    hc = (neck[0] + hoff[0], neck[1] + hoff[1])
    face = p.get("face", "normal")

    def head_in(x, y):
        lx, ly = rot(x - hc[0], y - hc[1], -ha)
        lx, ly = lx / HR, ly / HR
        # a round skull and a slightly narrower jaw
        if ly < 3:
            return (lx / 11.6) ** 2 + (ly / 12.2) ** 2 <= 1
        return (lx / 10.2) ** 2 + ((ly - 1) / 11.4) ** 2 <= 1 if ly < 12.5 else False

    def head_mat(x, y):
        lx, ly = rot(x - hc[0], y - hc[1], -ha)
        lx, ly = lx / HR, ly / HR
        # the spark: a red bolt down the forehead
        if in_poly(lx, ly, [(1.5, -11.5), (5.5, -11), (3, -6.5), (5.5, -6.5), (0.5, 0), (2, -5), (-0.5, -5)]):
            return ("red", 0)
        # eye holes trimmed in blue (the front eye larger in 3/4)
        for ex, ew in ((6.0, 3.5), (-2.8, 2.5)):
            # almond-shaped holes, tipped up toward the outside like a luchador's
            ey = 2.0 - (lx - ex) * (0.18 if ex > 0 else -0.18)
            dx, dy = (lx - ex) / (ew + 1.4), (ly - ey) / 4.1
            if dx * dx + dy * dy <= 1:
                inner = ((lx - ex) / ew) ** 2 + ((ly - ey) / 2.9) ** 2 <= 1
                if not inner:
                    return ("blue", 0)
                if face == "hurt":
                    return ("eye_shut", 0) if abs(ly - 2.5 - (lx - ex) * 0.5) < 0.8 else ("skin", 1)
                if face == "ko":
                    return ("eye_shut", 0) if abs(abs(lx - ex) - abs(ly - 2.5)) < 0.8 else ("skin", 1)
                if face == "happy":
                    return ("eye_shut", 0) if (ly - 2.5) > -0.2 and abs(ly - 2.5 - 1.6 + ((lx - ex) / ew) ** 2 * 1.6) < 0.8 else ("skin", 1)
                # eye white, pupil looking ahead
                if (lx - ex - ew * 0.38) ** 2 / 1.3 + (ly - ey - 0.3) ** 2 / 2.6 <= 1:
                    return ("pupil", 0)
                return ("eye", 0)
        # mouth opening
        if 4 < lx < 9.5 and 7.5 < ly < 11:
            if face in ("hurt", "ko"):
                return ("dark", 1) if 8.5 < ly < 10.5 and 5 < lx < 9 else ("skin", 0)
            if face == "happy":
                return ("dark", 1) if 8.3 < ly < 10.5 and 5 < lx < 9 - (ly - 8.3) else ("skin", 0)
            return ("dark", 1) if 9 < ly < 10 and 5.5 < lx < 8.5 else ("skin", 0)
        # trim lines around the mask's face
        if abs((lx / 11.6) ** 2 + (ly / 12.2) ** 2 - 1) < 0.08 and ly < 3 and lx < -6:
            return ("red", 0)
        return ("mask", 0)
    parts.append(Part("head", 6, head_in, head_mat, light=4.5, rim=1.6))
    # a short neck under the mask
    nb = rot(1, -1, ha)
    nt = rot(2, -6, ha)
    parts.append(Part("neck", 4.5, capsule((neck[0] + nb[0], neck[1] + nb[1]), (neck[0] + nt[0], neck[1] + nt[1]), 5.0, 5.0),
                      lambda x, y: ("skin", 1), light=3))
    # the spark crest on top of the mask
    crest = [(-7, -9.5), (-4.5, -17), (-1.5, -13), (1.5, -19.5), (3.5, -13.5), (7.5, -16.5), (7, -9)]
    cpts = []
    for cx_, cy_ in crest:
        rx, ry = rot(cx_ * HR, cy_ * HR, ha)
        cpts.append((hc[0] + rx, hc[1] + ry))
    parts.append(Part("crest", 5.9, lambda x, y: in_poly(x, y, cpts), lambda x, y: ("red", 0), light=3, rim=1.2))
    # mask laces at the back of the head
    lace0 = rot(-11.5 * HR, 2, ha)
    lace = (hc[0] + lace0[0], hc[1] + lace0[1])
    lace_end = (lace[0] - 4 + p.get("lace_dx", 0), lace[1] + 4 + p.get("lace_dy", 0))
    parts.append(Part("laces", 2.5, capsule(lace, lace_end, 1.3, 1.0), lambda x, y: ("red", 0), light=1, rim=0.5))

    # arms: hand targets relative to the shoulders
    def arm(side, sh, hand, z, bend):
        hand = (sh[0] + hand[0], sh[1] + hand[1])
        elbow = ik(sh, hand, UA, FA, bend)
        dim = 0 if side == "front" else 1
        fa = along(elbow, hand)
        def ua_mat(x, y):
            return ("skin", dim)
        def fa_mat(x, y):
            t, s = fa(x, y)
            return ("red", dim) if t > 0.62 else ("skin", dim)  # wristband
        parts.append(Part(f"upper_{side}", z, capsule(sh, elbow, 6.0, 5.0), ua_mat))
        parts.append(Part(f"fore_{side}", z + 0.1, capsule(elbow, hand, 5.0, 4.6), fa_mat))
        # taped fist
        parts.append(Part(f"fist_{side}", z + 0.2, capsule(hand, hand, 5.8, 5.8), lambda x, y: ("tape", dim), light=2.6))

    arm("back", sh_back, p.get("hb", (-4, 20)), p.get("zb", 0), p.get("eb", 1))
    arm("front", sh_front, p.get("hf", (4, 20)), p.get("zf", 7), p.get("ef", -1))
    return parts


# ── rendering a pose into a 96x96 frame ─────────────────────────────────
WC, O = 160, 32  # work canvas (room for falls), and where the 96x96 frame sits in it


def render(parts, rotate=0.0, pivot=(48, FLOOR), shift=(0, 0), fit=False):
    """Material map → shaded, outlined pixels. `rotate` turns the whole figure
    (falls); `fit` moves the result to stand on the floor, centred, inside the frame."""
    order = sorted(parts, key=lambda q: q.z)

    def sample(px, py):
        x, y = px - O + 0.5, py - O + 0.5
        # undo the whole-figure rotation and shift
        if rotate or shift != (0, 0):
            x, y = x - shift[0], y - shift[1]
            rx, ry = rot(x - pivot[0], y - pivot[1], -rotate)
            x, y = rx + pivot[0], ry + pivot[1]
        return x, y

    owner = [[None] * WC for _ in range(WC)]
    for py in range(WC):
        for px in range(WC):
            x, y = sample(px, py)
            for part in reversed(order):
                if part.inside(x, y):
                    owner[py][px] = part
                    break

    img = Image.new("RGBA", (WC, WC), (0, 0, 0, 0))
    out = img.load()
    LX, LY = -0.62, -0.78  # light from the upper left
    for py in range(WC):
        for px in range(WC):
            part = owner[py][px]
            if not part:
                continue
            x, y = sample(px, py)
            mat, dim = part.material(x, y)
            if mat == "eye":
                out[px, py] = EYE
                continue
            if mat == "pupil" or mat == "eye_shut":
                out[px, py] = PUPIL
                continue
            # tone from how far the part reaches toward / away from the light
            # (undo the figure's rotation so the light stays fixed on screen)
            def inside_at(k):
                ox, oy = rot(LX * k, LY * k, -rotate)
                return part.inside(x + ox, y + oy)

            def inside_away(k):
                ox, oy = rot(-LX * k, -LY * k, -rotate)
                return part.inside(x + ox, y + oy)

            if not inside_at(part.rim):
                tone = 0
            elif not inside_away(part.light * 0.45):
                tone = 3
            elif not inside_away(part.light):
                tone = 2
            else:
                tone = 1
            tone = min(3, tone + dim)
            out[px, py] = PAL[mat][tone]

    def n4(px, py):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            qx, qy = px + dx, py + dy
            yield dx, dy, (owner[qy][qx] if 0 <= qx < WC and 0 <= qy < WC else None)

    # lines where a part passes in front of another
    lines = []
    edge = []
    for py in range(WC):
        for px in range(WC):
            a = owner[py][px]
            if not a:
                continue
            for dx, dy, b in n4(px, py):
                if b is None:
                    edge.append((px, py, dx, dy))
                    break
            else:
                if any(b is not a and b.z > a.z + 0.5 for _, _, b in n4(px, py)):
                    lines.append((px, py))
    for px, py in lines:
        r, g, b, _ = out[px, py]
        out[px, py] = (int(r * 0.5) + 10, int(g * 0.45) + 6, int(b * 0.55) + 14, 255)
    # selective outline: dark below and right, a deep tone of the part above and left
    for px, py, dx, dy in edge:
        if dx < 0 or dy < 0:
            r, g, b, _ = out[px, py]
            out[px, py] = (int(r * 0.42) + 8, int(g * 0.36) + 6, int(b * 0.46) + 14, 255)
        else:
            out[px, py] = OUTLINE

    if fit:
        x0, y0, x1, y1 = img.getbbox()
        w = x1 - x0
        nx = max(0, min(S - w, round(48 - w / 2)))
        ny = FLOOR + 1 - (y1 - y0)
        frame = Image.new("RGBA", (S, S), (0, 0, 0, 0))
        frame.alpha_composite(img.crop((x0, y0, x1, y1)), (nx, ny))
        return frame
    return img.crop((O, O, O + S, O + S))


# ── the animations ──────────────────────────────────────────────────────
# the guard: crouched a little, fists up in front, the back fist in front of the chest
BASE = dict(hx=0, hy=2, lean=0.1, tilt=0, fbx=-10, ffx=9, hb=(12.5, 7), zb=6.5, hf=(13, 9), eb=1, ef=1)


def pose(**kw):
    d = dict(BASE)
    d.update(kw)
    return d


def idle():
    out = []
    for i in range(4):
        b = [0, 0.8, 1.6, 0.8][i]
        out.append(pose(hy=2 + b, hb=(12.5, 7 - b * 0.6), hf=(13, 9 - b * 0.6), lace_dy=b * 0.5))
    return [(build(p), {}) for p in out]


def walk():
    out = []
    for i in range(8):
        ph = i / 8 * 2 * math.pi
        stride = 9.5
        lift_f = max(0, math.cos(ph)) * 5
        lift_b = max(0, -math.cos(ph)) * 5
        bob = 2 - abs(math.sin(ph)) * 1.6
        sw = math.sin(ph) * 2.5
        out.append(pose(
            hy=bob, lean=0.16,
            ffx=math.sin(ph) * stride + 1, ffy=-lift_f, fbx=-math.sin(ph) * stride - 1, fby=-lift_b,
            hf=(13 - sw, 9), hb=(12.5 + sw, 8),
            lace_dx=-2, lace_dy=-1,
        ))
    return [(build(p), {}) for p in out]


def attack():
    keys = [
        # wind up: lean back, the chopping hand raised behind the head
        pose(lean=-0.08, hf=(-8, -14), zf=5, ef=1, hb=(16, 2), hy=2, ffx=10, fbx=-10, lace_dx=1),
        pose(lean=-0.16, hf=(-11, -17), zf=5, ef=1, hb=(16, 1), hy=2.5, ffx=11, fbx=-11, lace_dx=2),
        # the chop: lunge, the hand slices across at chest height
        pose(lean=0.34, hf=(25, -2), ef=-1, hb=(2, 12), zb=0, hx=3, hy=3, ffx=14, fbx=-11, lace_dx=-4, lace_dy=-2),
        pose(lean=0.38, hf=(26, 5), ef=-1, hb=(0, 14), zb=0, hx=4, hy=3.5, ffx=14, fbx=-12, lace_dx=-4, lace_dy=-2),
        # follow through and settle
        pose(lean=0.26, hf=(20, 13), ef=-1, hb=(8, 10), hx=2, hy=3, ffx=12, fbx=-11, lace_dx=-2),
        pose(lean=0.14, hf=(13, 9), hb=(16, 5), hx=1, hy=2.5, ffx=10, fbx=-10),
    ]
    return [(build(p), {}) for p in keys]


def hurt():
    keys = [
        pose(lean=-0.34, tilt=-0.3, hx=-4, hy=2, hf=(-4, 12), ef=-1, hb=(-12, 8), zb=0, ffx=7, fbx=-12, face="hurt", lace_dx=4, lace_dy=-2),
        pose(lean=-0.26, tilt=-0.22, hx=-3, hy=2.5, hf=(0, 13), ef=-1, hb=(-10, 11), zb=0, ffx=7, fbx=-11, face="hurt", lace_dx=3),
        pose(lean=-0.04, tilt=-0.06, hx=-1, hy=2, hf=(9, 10), hb=(14, 6), ffx=8, fbx=-10, face="hurt"),
    ]
    return [(build(p), {}) for p in keys]


def knocked_out():
    # stagger back, fall backward, land flat on the canvas
    keys = [
        (pose(lean=-0.3, tilt=-0.3, hx=-3, hy=2, hf=(-6, 8), ef=-1, hb=(-14, 6), zb=0, face="ko", ffx=7, fbx=-7), 0.0, (0, 0)),
        (pose(lean=-0.15, tilt=-0.2, hy=4, hf=(-10, -6), ef=-1, hb=(-16, -4), zb=0, face="ko", ffx=9, fbx=-5), -0.65, (0, 0)),
        (pose(lean=0.0, tilt=-0.1, hy=5, hf=(-12, -12), ef=-1, hb=(-17, -10), zb=0, face="ko", ffx=9, fbx=-3), -1.25, (0, 0)),
        (pose(lean=0.0, tilt=0.0, hy=5, hf=(-13, -15), ef=-1, hb=(-17, -13), zb=0, face="ko", ffx=10, fbx=-2), -1.5708, (0, 0)),
    ]
    return [(build(p), dict(rotate=r, shift=s, pivot=(48, FLOOR - 4), fit=i > 0)) for i, (p, r, s) in enumerate(keys)]


def victory():
    keys = [
        pose(lean=0.02, hf=(12, 4), hb=(12, 14), face="happy", hy=2),
        pose(lean=-0.02, hf=(13, -12), zf=5, hb=(12, 14), face="happy", hy=1),
        pose(lean=-0.05, hf=(13, -26), zf=5, hb=(12, 13), face="happy", hy=0, ffx=9, fbx=-10),
        # the held pose: fist to the sky, the other hand on the belt
        pose(lean=-0.06, tilt=-0.06, hf=(12, -29), zf=5, hb=(13, 13), face="happy", hy=0, ffx=10, fbx=-11),
    ]
    return [(build(p), {}) for p in keys]


ROWS = [idle, walk, attack, hurt, knocked_out, victory]

if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "art/sprites/kid_chispa.png"
    sheet = Image.new("RGBA", (COLS * S, len(ROWS) * S), (0, 0, 0, 0))
    for r, fn in enumerate(ROWS):
        for c, (parts, opts) in enumerate(fn()):
            sheet.alpha_composite(render(parts, **opts), (c * S, r * S))
    import os
    os.makedirs(os.path.dirname(out) or ".", exist_ok=True)
    sheet.save(out)
    print("wrote", out, sheet.size)
