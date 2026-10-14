"""A pixel-art figure rig: body parts posed on a skeleton, shaded and outlined
pixel by pixel (four tones per material lit from the upper left, a selective
outline, dark lines where a part passes in front of another).

Figures are designed on Kid Chispa's 96-pixel grid ("model units") and drawn at
a scale: 1 for normal fighters (96x96 frames), 1.5 for big ones (144), 2.5 for
huge ones (240). Drawing at a bigger scale adds pixels (detail), not blur.

Sheets have one row per animation: idle, walk, attack, hurt, knocked out, victory.
"""
import math
from PIL import Image

COLS = 8
FLOOR = 95  # model units: feet stand on the frame's last row


def hx(c):
    return tuple(int(c[i:i + 2], 16) for i in (1, 3, 5)) + (255,)


def ramp(*cs):
    """A material: highlight, base, shade, deep."""
    return [hx(c) for c in cs]


OUTLINE = hx("#1a1424")
EYE = hx("#ffffff")
PUPIL = hx("#1a1424")


def rot(x, y, a):
    c, s = math.cos(a), math.sin(a)
    return x * c - y * s, x * s + y * c


def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    L2 = dx * dx + dy * dy or 1e-9
    t = max(0.0, min(1.0, ((px - ax) * dx + (py - ay) * dy) / L2))
    return math.hypot(px - (ax + dx * t), py - (ay + dy * t)), t


def in_poly(px, py, pts):
    inside = False
    n = len(pts)
    for i in range(n):
        x1, y1 = pts[i]
        x2, y2 = pts[(i + 1) % n]
        if (y1 > py) != (y2 > py):
            if px < x1 + (py - y1) * (x2 - x1) / (y2 - y1):
                inside = not inside
    return inside


class Part:
    def __init__(self, name, z, inside, material, light=3.0, rim=1.4):
        self.name, self.z, self.inside, self.material = name, z, inside, material
        self.light, self.rim = light, rim


def capsule(a, b, r1, r2):
    def inside(x, y):
        d, t = seg_dist(x, y, *a, *b)
        return d <= r1 + (r2 - r1) * t
    return inside


def ellipse(c, rx, ry, ang=0.0):
    def inside(x, y):
        lx, ly = rot(x - c[0], y - c[1], -ang)
        return (lx / rx) ** 2 + (ly / ry) ** 2 <= 1
    return inside


def along(a, b):
    """Position along a limb (0 at a, 1 at b) and across it (signed, in model units)."""
    def f(x, y):
        dx, dy = b[0] - a[0], b[1] - a[1]
        L = math.hypot(dx, dy) or 1e-9
        return ((x - a[0]) * dx + (y - a[1]) * dy) / (L * L), ((x - a[0]) * -dy + (y - a[1]) * dx) / L
    return f


def ik(root, target, l1, l2, bend):
    dx, dy = target[0] - root[0], target[1] - root[1]
    d = max(min(math.hypot(dx, dy), l1 + l2 - 0.01), abs(l1 - l2) + 0.01)
    a = math.atan2(dy, dx)
    b = math.acos(max(-1, min(1, (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d))))
    ang = a + bend * b
    return root[0] + math.cos(ang) * l1, root[1] + math.sin(ang) * l1


def local(c, ang, scale=1.0):
    """Coordinates around a centre, unrotated (and divided by a scale)."""
    def f(x, y):
        lx, ly = rot(x - c[0], y - c[1], -ang)
        return lx / scale, ly / scale
    return f


def poly_at(origin, ang, pts, sx=1.0, sy=1.0):
    out = []
    for x, y in pts:
        rx, ry = rot(x * sx, y * sy, ang)
        out.append((origin[0] + rx, origin[1] + ry))
    return out


# ── faces ───────────────────────────────────────────────────────────────

def eye(lx, ly, ex, ey, ew, eh, face, pupil_dx=0.38, white=True):
    """A cartoon eye at (ex, ey): the material at (lx, ly), or None outside it."""
    dx, dy = (lx - ex) / ew, (ly - ey) / eh
    if dx * dx + dy * dy > 1:
        return None
    if face == "hurt":
        return "eye_shut" if abs((ly - ey) - (lx - ex) * 0.5) < 0.75 else None
    if face == "ko":
        return "eye_shut" if abs(abs(lx - ex) - abs(ly - ey)) < 0.75 else None
    if face == "happy":
        return "eye_shut" if abs((ly - ey) + 0.6 - dx * dx * 1.4) < 0.7 else None
    if (lx - ex - ew * pupil_dx) ** 2 / max(0.8, ew * 0.3) + (ly - ey) ** 2 / max(1.2, eh * 0.55) <= 1:
        return "pupil"
    return "eye" if white else None


# ── rendering ───────────────────────────────────────────────────────────

def render(parts, pal, scale=1.0, rotate=0.0, pivot=(48, FLOOR), shift=(0, 0), fit=False):
    """Material map → shaded, outlined pixels at a scale (frames are 96·scale square)."""
    F = round(96 * scale)
    WC = round(170 * scale)
    O = round(37 * scale)
    order = sorted(parts, key=lambda q: q.z)

    def sample(px, py):
        x, y = (px - O + 0.5) / scale, (py - O + 0.5) / scale
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
    LX, LY = -0.62, -0.78
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
            if mat in ("pupil", "eye_shut"):
                out[px, py] = PUPIL
                continue

            def inside_off(k, sign):
                ox, oy = rot(sign * LX * k, sign * LY * k, -rotate)
                return part.inside(x + ox, y + oy)

            # the rim of light stays about a pixel and a half wide at any scale
            if not inside_off(part.rim / scale ** 0.5, 1):
                tone = 0
            elif not inside_off(part.light * 0.45, -1):
                tone = 3
            elif not inside_off(part.light, -1):
                tone = 2
            else:
                tone = 1
            out[px, py] = pal[mat][min(3, tone + dim)]

    def n4(px, py):
        for dx, dy in ((1, 0), (-1, 0), (0, 1), (0, -1)):
            qx, qy = px + dx, py + dy
            yield dx, dy, (owner[qy][qx] if 0 <= qx < WC and 0 <= qy < WC else None)

    lines, edge = [], []
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
    for px, py, dx, dy in edge:
        if dx < 0 or dy < 0:
            r, g, b, _ = out[px, py]
            out[px, py] = (int(r * 0.42) + 8, int(g * 0.36) + 6, int(b * 0.46) + 14, 255)
        else:
            out[px, py] = OUTLINE

    if fit:
        box = img.getbbox()
        if not box:
            return Image.new("RGBA", (F, F), (0, 0, 0, 0))
        x0, y0, x1, y1 = box
        w, h = x1 - x0, y1 - y0
        crop = img.crop((x0, y0, x1, y1))
        if w > F:
            crop = crop.crop(((w - F) // 2, 0, (w - F) // 2 + F, h))
            w = F
        frame = Image.new("RGBA", (F, F), (0, 0, 0, 0))
        frame.alpha_composite(crop, (max(0, min(F - w, round(F / 2 - w / 2))), F - h))
        return frame
    return img.crop((O, O, O + F, O + F))


def sheet(rows, pal, scale):
    """Rows of (parts, render options) → one sprite sheet image."""
    F = round(96 * scale)
    img = Image.new("RGBA", (COLS * F, len(rows) * F), (0, 0, 0, 0))
    for r, frames in enumerate(rows):
        for c, (parts, opts) in enumerate(frames):
            img.alpha_composite(render(parts, pal, scale, **opts), (c * F, r * F))
    return img


# ── a humanoid ──────────────────────────────────────────────────────────

class Body:
    """Proportions and costume of a humanoid. Material callbacks get positions
    along/across a limb (t, s) or local coordinates (lx, ly), and the face."""

    TH, SH, UA, FA, TORSO = 14.5, 15.0, 12.0, 11.0, 24.0
    HIP_W = 6.5
    SHOULDER = (10, 8.5)  # front, back offsets from the neck
    TORSO_POLY = [(-12, 0), (-13.5, -9), (-15, -18), (-13.5, -24), (14, -24), (15.5, -18), (13.5, -9), (12, 0)]
    R = dict(thigh=(7.6, 6.2), shin=(6.2, 6.8), foot=(5.6, 4.6), foot_len=9.5, upper=(6.0, 5.0), fore=(5.0, 4.6), fist=5.8)
    HEAD_C = (2, -13.5)
    HEAD_S = 1.32
    NECK_R = 5.0

    def thigh(self, t, s, side):
        return "skin"

    def shin(self, t, s, side):
        return "skin"

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "boot"

    def torso(self, lx, ly):
        return "shirt"

    def upper(self, t, s, side):
        return "skin"

    def fore(self, t, s, side):
        return "skin"

    def fist(self, side):
        return "skin"

    def head_in(self, lx, ly):
        if ly < 3:
            return (lx / 11.6) ** 2 + (ly / 12.2) ** 2 <= 1
        return ly < 12.5 and (lx / 10.2) ** 2 + ((ly - 1) / 11.4) ** 2 <= 1

    def head(self, lx, ly, face):
        return "skin"

    def extras(self, j, p, parts):
        """Hats, capes, spikes…: more parts from the joints."""


def build(body, p):
    """The parts of a humanoid in a pose (see POSES below for the keys)."""
    B = body
    parts = []
    hip = (48 + p.get("hx", 0), FLOOR - 3 - (B.TH + B.SH) * 0.95 + p.get("hy", 0))
    lean = p.get("lean", 0.0)
    up = rot(0, -B.TORSO, lean)
    neck = (hip[0] + up[0], hip[1] + up[1])
    acr = rot(1, 0, lean)
    sh_front = (neck[0] + acr[0] * B.SHOULDER[0] + 1, neck[1] + acr[1] * B.SHOULDER[0] + 5)
    sh_back = (neck[0] - acr[0] * B.SHOULDER[1], neck[1] - acr[1] * B.SHOULDER[1] + 5)
    j = dict(hip=hip, neck=neck, lean=lean, acr=acr, sh_front=sh_front, sh_back=sh_back)

    def leg(side, foot, z, bend):
        root = (hip[0] + (B.HIP_W if side == "front" else -B.HIP_W) * acr[0], hip[1] + 1)
        knee = ik(root, foot, B.TH, B.SH, bend)
        dim = 0 if side == "front" else 1
        th, sh = along(root, knee), along(knee, foot)
        parts.append(Part(f"thigh_{side}", z, capsule(root, knee, *B.R["thigh"]), lambda x, y: (B.thigh(*th(x, y), side), dim)))
        parts.append(Part(f"shin_{side}", z + 0.1, capsule(knee, foot, *B.R["shin"]), lambda x, y: (B.shin(*sh(x, y), side), dim)))
        fa = p.get(f"foot_{side}_ang", 0.0)
        L = B.R["foot_len"]
        toe = (foot[0] + math.cos(fa) * L, foot[1] + math.sin(fa) * L - 0.5)
        heel = (foot[0] - math.cos(fa) * 3, foot[1] - math.sin(fa) * 3)
        ft = along(heel, toe)
        parts.append(Part(f"foot_{side}", z + 0.2, capsule(heel, toe, *B.R["foot"]), lambda x, y: (B.foot(*ft(x, y), side), dim)))
        j[f"knee_{side}"] = knee
        j[f"foot_{side}"] = foot

    leg("back", (hip[0] + p.get("fbx", -6), FLOOR - 3 + p.get("fby", 0)), 1, p.get("bend_back", -1))
    leg("front", (hip[0] + p.get("ffx", 7), FLOOR - 3 + p.get("ffy", 0)), 4, p.get("bend_front", -1))

    tpts = poly_at(hip, lean, [(x, y + 2) for x, y in B.TORSO_POLY])
    tl = local(hip, lean)

    def torso_mat(x, y):
        lx, ly = tl(x, y)
        return (B.torso(lx, ly - 2), 0)

    parts.append(Part("torso", 3, lambda x, y: in_poly(x, y, tpts), torso_mat, light=4.5))

    ha = lean + p.get("tilt", 0)
    hoff = rot(B.HEAD_C[0], B.HEAD_C[1], ha)
    hc = (neck[0] + hoff[0], neck[1] + hoff[1])
    hl = local(hc, ha, B.HEAD_S)
    face = p.get("face", "normal")
    parts.append(Part("head", 6, lambda x, y: B.head_in(*hl(x, y)), lambda x, y: (B.head(*hl(x, y), face), 0), light=4.5, rim=1.6))
    nb, nt = rot(1, -1, ha), rot(2, -6, ha)
    parts.append(Part("neck", 4.5, capsule((neck[0] + nb[0], neck[1] + nb[1]), (neck[0] + nt[0], neck[1] + nt[1]), B.NECK_R, B.NECK_R),
                      lambda x, y: ("skin", 1), light=3))
    j.update(head=hc, head_ang=ha, face=face)

    def arm(side, sh, hand, z, bend):
        hand = (sh[0] + hand[0], sh[1] + hand[1])
        elbow = ik(sh, hand, B.UA, B.FA, bend)
        dim = 0 if side == "front" else 1
        ua, fa = along(sh, elbow), along(elbow, hand)
        parts.append(Part(f"upper_{side}", z, capsule(sh, elbow, *B.R["upper"]), lambda x, y: (B.upper(*ua(x, y), side), dim)))
        parts.append(Part(f"fore_{side}", z + 0.1, capsule(elbow, hand, *B.R["fore"]), lambda x, y: (B.fore(*fa(x, y), side), dim)))
        parts.append(Part(f"fist_{side}", z + 0.2, capsule(hand, hand, B.R["fist"], B.R["fist"]), lambda x, y: (B.fist(side), dim), light=2.6))
        j[f"hand_{side}"] = hand
        j[f"elbow_{side}"] = elbow

    arm("back", sh_back, p.get("hb", (-4, 20)), p.get("zb", 0), p.get("eb", 1))
    arm("front", sh_front, p.get("hf", (4, 20)), p.get("zf", 7), p.get("ef", -1))
    B.extras(j, p, parts)
    return parts


# ── poses ───────────────────────────────────────────────────────────────

def poses(base, attack_keys=None, scale_attack=1.0):
    """The six animation rows for a humanoid with a resting pose `base`.
    Returns rows of pose dicts plus render options."""

    def pose(**kw):
        d = dict(base)
        d.update(kw)
        return d

    hy = base.get("hy", 2)
    hf, hb = base.get("hf", (12, 8)), base.get("hb", (12, 7))
    idle = []
    for b in (0, 0.8, 1.6, 0.8):
        idle.append((pose(hy=hy + b, hf=(hf[0], hf[1] - b * 0.6), hb=(hb[0], hb[1] - b * 0.6)), {}))
    walk = []
    for i in range(8):
        ph = i / 8 * 2 * math.pi
        sw = math.sin(ph) * 2.5
        walk.append((pose(
            hy=hy - abs(math.sin(ph)) * 1.6 + 0.4,
            lean=base.get("lean", 0.1) + 0.06,
            ffx=math.sin(ph) * 9.5 + 1, ffy=-max(0, math.cos(ph)) * 5,
            fbx=-math.sin(ph) * 9.5 - 1, fby=-max(0, -math.cos(ph)) * 5,
            hf=(hf[0] - sw, hf[1]), hb=(hb[0] + sw, hb[1] + 1),
        ), {}))
    r = base.get("reach", 1.0)
    x0 = base.get("hx", 0)
    attack = attack_keys or [
        # wind up, then a big shove / swing forward
        pose(lean=-0.1, hf=(-6, -6), zf=5, ef=1, hb=(10, 4), ffx=10, fbx=-10),
        pose(lean=-0.18, hf=(-9, -10), zf=5, ef=1, hb=(9, 2), ffx=11, fbx=-11),
        pose(lean=0.36, hf=(25 * r, 0), ef=-1, hb=(18 * r, 6), zb=6.5, hx=x0 + 4 * r, hy=hy + 1, ffx=15, fbx=-11),
        pose(lean=0.4, hf=(26 * r, 4), ef=-1, hb=(20 * r, 9), zb=6.5, hx=x0 + 5 * r, hy=hy + 1.5, ffx=15, fbx=-12),
        pose(lean=0.26, hf=(19 * r, 11), ef=-1, hb=(14, 9), hx=x0 + 3, hy=hy + 1, ffx=12, fbx=-11),
        pose(lean=base.get("lean", 0.1) + 0.04, hx=x0 + 1),
    ]
    attack = [(a, {}) if isinstance(a, dict) else a for a in attack]
    hurt = [
        (pose(lean=-0.34, tilt=-0.3, hx=-4, hf=(-4, 12), ef=-1, hb=(-12, 8), zb=0, ffx=7, fbx=-12, face="hurt"), {}),
        (pose(lean=-0.26, tilt=-0.22, hx=-3, hy=hy + 0.5, hf=(0, 13), ef=-1, hb=(-10, 11), zb=0, ffx=7, fbx=-11, face="hurt"), {}),
        (pose(lean=-0.04, tilt=-0.06, hx=-1, face="hurt"), {}),
    ]
    ko = []
    for i, (kw, r) in enumerate([
        (dict(lean=-0.3, tilt=-0.3, hx=-3, hf=(-6, 8), ef=-1, hb=(-14, 6), zb=0, ffx=7, fbx=-7), 0.0),
        (dict(lean=-0.15, tilt=-0.2, hy=hy + 2, hf=(-10, -6), ef=-1, hb=(-16, -4), zb=0, ffx=9, fbx=-5), -0.65),
        (dict(lean=0.0, tilt=-0.1, hy=hy + 3, hf=(-12, -12), ef=-1, hb=(-17, -10), zb=0, ffx=9, fbx=-3), -1.25),
        (dict(lean=0.0, tilt=0.0, hy=hy + 3, hf=(-13, -15), ef=-1, hb=(-17, -13), zb=0, ffx=10, fbx=-2), -1.5708),
    ]):
        ko.append((pose(face="ko", **kw), dict(rotate=r, pivot=(48, FLOOR - 4), fit=i > 0)))
    win = [
        (pose(lean=0.02, hf=(12, 4), hb=(12, 14), face="happy"), {}),
        (pose(lean=-0.02, hf=(13, -12), zf=5, hb=(12, 14), face="happy"), {}),
        (pose(lean=-0.05, hf=(13, -26), zf=5, hb=(12, 13), face="happy", ffx=9, fbx=-10), {}),
        (pose(lean=-0.06, tilt=-0.06, hf=(12, -29), zf=5, hb=(13, 13), face="happy", ffx=10, fbx=-11), {}),
    ]
    return [idle, walk, attack, hurt, ko, win]


def humanoid_sheet(body, pal, scale, base, attack_keys=None):
    rows = poses(base, attack_keys)
    built = [[(build(body, p), opts) for p, opts in row] for row in rows]
    return sheet(built, pal, scale)
