"""Pip, Kid Chispa's partner: a pint-sized ringside announcer with a mic, a
bowtie and a vest. Finished-style sheet on the shared rig (120-pixel frames,
facing right like Kid Chispa).

Usage: python3 tools/art/pip.py   (writes art/sprites/pip_v1.png, Pip's first look; the game now uses
the painted sheet re-cut by tools/art/recut_painted.py, see art/sprites/pip_v2_source.png)
"""
import math, os
from rig import Part, capsule, ellipse, eye, ik, local, poly_at, ramp, rot, sheet, FLOOR

PAL = dict(
    skin=ramp("#f8cfa0", "#e3a274", "#bd7650", "#8c5036"),
    hair=ramp("#ffb05a", "#f07a2c", "#c0561a", "#7e3410"),
    vest=ramp("#9a8cff", "#6650e0", "#4834a8", "#2c1f70"),
    shirt=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
    tie=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"),
    pants=ramp("#5a6a90", "#3c4a6c", "#2a344e", "#1b2234"),
    shoe=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"),
    sole=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
    steel=ramp("#f4f6ff", "#b8bfd6", "#7f87a3", "#4f5670"),
    dark=ramp("#4a3f5c", "#2e2640", "#221c30", "#17121f"),
    gold=ramp("#fff2a0", "#f6c94b", "#d4981e", "#9a6812"),
    mouth=ramp("#a8344a", "#7c2236", "#5a1826", "#3a0e18"),
    freckle=ramp("#d98a5c", "#c0704a", "#9c5638", "#6c3a24"),
)


def pip(hop=0.0, dx=0.0, lean=0.0, squash=1.0, hand_f=(9, 2), hand_b=(-8, 4), mic="hand", mic_ang=-1.2,
        mic_at=None, face="normal", mouth="smile", step=0.0, tuck=0.0):
    """One pose. Hands are relative to their shoulders; mic: 'hand', 'free' (at mic_at) or None."""
    parts = []
    fx = 48 + dx
    floor = FLOOR - 1
    hip = (fx + rot(0, -10 * squash, lean)[0] * 0, floor - 9 * squash - hop)
    # legs: short, sneakers
    for side, z, k in (("back", 1, -1), ("front", 3, 1)):
        s = step * k
        foot = (fx + 3 * k * 0.6 + s * 4 - tuck * 2, floor - hop - tuck * 3.5 * (1.2 if k > 0 else 0.8))
        if hop == 0 and tuck == 0:
            foot = (foot[0], floor - max(0, s) * 2.5)
        h = (hip[0] + k * 2.5, hip[1])
        parts.append(Part(f"leg_{side}", z, capsule(h, (foot[0], foot[1] - 2.5), 3.0, 2.6),
                          lambda x, y, d=(1 if side == "back" else 0): ("pants", d), light=2, rim=1))
        sh = ellipse((foot[0] + 1.6, foot[1] - 1.6), 4.2, 2.6)
        parts.append(Part(f"shoe_{side}", z + 0.2, sh,
                          lambda x, y, fy=foot[1], d=(1 if side == "back" else 0): ("sole" if y > fy - 0.9 else "shoe", d),
                          light=2, rim=1))
    # torso: a round little body, vest open over a white shirt
    tc = (hip[0] + rot(0, -7, lean)[0], hip[1] + rot(0, -7, lean)[1])
    tl = local(tc, lean)

    def torso_mat(x, y):
        lx, ly = tl(x, y)
        if ly > 5.2:
            return ("pants", 0)
        if abs(lx - 2.0) < 2.6 + max(0, ly) * 0.15:
            if abs(lx - 2.0) < 0.5 and int(ly) in (-1, 2):
                return ("dark", 0)  # buttons
            return ("shirt", 0)
        return ("vest", 0)
    parts.append(Part("torso", 4, ellipse(tc, 8.2 * (2 - squash) ** 0.5, 9.0 * squash, lean), torso_mat, light=4))
    bow = poly_at(tc, lean, [(-2.6, -5.2), (2.0, -3.2), (6.6, -5.2), (6.6, -0.8), (2.0, -2.8), (-2.6, -0.8)])
    parts.append(Part("bowtie", 6.5, lambda x, y: in_bow(x, y, bow), lambda x, y: ("tie", 0), light=1.5, rim=0.8))
    # head: big, with a ginger cowlick
    hc = (tc[0] + rot(1.0, -17.5, lean * 1.3)[0], tc[1] + rot(1.0, -17.5, lean * 1.3)[1])
    hl = local(hc, lean * 1.3)

    def head_mat(x, y):
        lx, ly = hl(x, y)
        if (ly < -4.8 + max(0, lx - 3) * 0.5 and lx < 9.5) or (lx < -5.0 and ly < 2.5 - max(0, -lx - 9) * 2):
            return ("hair", 0)
        e = eye(lx, ly, 5.8, -0.5, 2.0, 2.8, face) or eye(lx, ly, -0.4, -0.5, 1.7, 2.8, face)
        if e:
            return (e, 0)
        if face not in ("hurt", "ko") and -4.4 < ly < -3.4 and (abs(lx - 5.8) < 2.2 or abs(lx + 0.4) < 1.8):
            return ("hair", 2)  # brows
        if (lx - 3) ** 2 + (ly - 3.2) ** 2 < 0.8 or (lx - 8.3) ** 2 + (ly - 3.2) ** 2 < 0.8:
            return ("freckle", 0)
        if mouth == "open" and (lx - 5.5) ** 2 / 4.5 + (ly - 6.3) ** 2 / 2.6 < 1:
            return ("mouth", 0)
        if mouth == "smile" and abs(ly - 5.6 - ((lx - 5.6) / 2.6) ** 2 * -1.2) < 0.55 and abs(lx - 5.6) < 2.6:
            return ("mouth", 0)
        if mouth == "flat" and abs(ly - 6) < 0.5 and 3.6 < lx < 7.6:
            return ("mouth", 0)
        return ("skin", 0)
    parts.append(Part("head", 6, ellipse(hc, 11.5, 10.8, lean * 1.3), head_mat, light=5))
    cow = poly_at(hc, lean * 1.3, [(-7, -7), (-6, -14), (-1, -18.5), (6, -17), (10, -12.5), (4, -13.5), (1, -10)])
    parts.append(Part("cowlick", 5.8, lambda x, y: in_bow(x, y, cow), lambda x, y: ("hair", 0), light=2, rim=1))
    ear = (hc[0] + rot(-3.2, 1.2, lean)[0], hc[1] + rot(-3.2, 1.2, lean)[1])
    parts.append(Part("ear", 6.3, ellipse(ear, 1.8, 2.4), lambda x, y: ("skin", 0), light=1.2, rim=0.9))
    # arms (2-bone, short) and hands
    hands = {}
    for side, z, sx, tgt in (("back", 2, -3.5, hand_b), ("front", 7, 4.0, hand_f)):
        shp = (tc[0] + rot(sx, -4.5, lean)[0], tc[1] + rot(sx, -4.5, lean)[1])
        hand = (shp[0] + tgt[0], shp[1] + tgt[1])
        el = ik(shp, hand, 5.2, 5.2, 1 if side == "front" else -1)
        d = 1 if side == "back" else 0
        parts.append(Part(f"upper_{side}", z, capsule(shp, el, 2.9, 2.5), lambda x, y, d=d: ("vest", d), light=2, rim=1))
        parts.append(Part(f"fore_{side}", z + 0.1, capsule(el, hand, 2.5, 2.2), lambda x, y, d=d: ("shirt", d), light=2, rim=1))
        parts.append(Part(f"hand_{side}", z + 0.3, ellipse(hand, 2.6, 2.6), lambda x, y, d=d: ("skin", d), light=1.5, rim=1))
        hands[side] = hand
    # the mic
    if mic:
        if mic == "hand":
            base = hands["front"]
            a = mic_ang
        else:
            base = (fx + mic_at[0], floor + mic_at[1])
            a = mic_at[2]
        tip = (base[0] + math.cos(a) * 6.5, base[1] + math.sin(a) * 6.5)
        butt = (base[0] - math.cos(a) * 2.5, base[1] - math.sin(a) * 2.5)
        z = 7.2 if mic == "hand" else 9
        parts.append(Part("mic_handle", z - 0.1, capsule(butt, tip, 1.3, 1.6), lambda x, y: ("dark", 0), light=1, rim=0.7))
        ml = local(tip, a)
        parts.append(Part("mic_head", z, ellipse(tip, 3.0, 3.0),
                          lambda x, y: ("gold" if abs(ml(x, y)[0] + 1.4) < 0.6 else "steel", 0), light=2, rim=1))
        if mic == "hand":
            parts.append(Part("grip", z + 0.1, ellipse(base, 2.4, 2.2), lambda x, y: ("skin", 0), light=1.2, rim=0.9))
    return parts


def in_bow(x, y, pts):
    from rig import in_poly
    return in_poly(x, y, pts)


def rows():
    idle = [pip(hop=0, squash=s, hand_f=(6, 3 - b), mic_ang=-1.25 - b * 0.05) for s, b in
            ((1.0, 0), (0.97, 0.5), (0.95, 1), (0.97, 0.5))]
    walk = []
    for i in range(8):
        t = i / 8 * math.tau
        h = abs(math.sin(t)) * 4
        walk.append(pip(hop=h, step=math.cos(t), squash=1 - (0.06 if h < 0.5 else 0), lean=0.08,
                        hand_f=(6, 2 + math.sin(t)), hand_b=(-7, 4 - math.sin(t)), tuck=0.0))
    # Mic Drop: crouch, spring up mic high, flick it forward, it drops, land, ta-da
    attack = [
        pip(squash=0.82, lean=0.05, hand_f=(3, 6), mic_ang=-1.4, mouth="flat"),
        pip(hop=14, squash=1.08, tuck=0.6, hand_f=(3, -10), hand_b=(-8, -3), mic_ang=-1.6, mouth="open"),
        pip(hop=20, tuck=0.8, lean=0.1, hand_f=(9, -7), hand_b=(-8, -2), mic_ang=-0.6, mouth="open"),
        pip(hop=16, tuck=0.5, lean=0.15, hand_f=(10, 1), hand_b=(-8, 0), mic="free", mic_at=(24, -14, 1.6), mouth="open"),
        pip(hop=3, squash=0.9, lean=0.05, hand_f=(10, 0), mic="free", mic_at=(25, -2, 1.9), mouth="smile"),
        pip(squash=0.94, hand_f=(9, -9), hand_b=(-8, -6), mic=None, face="happy", mouth="open"),
    ]
    hurt = [
        pip(dx=-5, lean=-0.35, squash=0.9, hand_f=(3, -8), hand_b=(-6, -8), mic_ang=-2.2, face="hurt", mouth="open"),
        pip(dx=-3, lean=-0.22, hand_f=(5, -4), hand_b=(-7, -5), mic_ang=-1.9, face="hurt", mouth="open"),
        pip(dx=-1, lean=-0.08, hand_f=(6, 1), face="hurt", mouth="flat"),
    ]
    ko_poses = [
        (dict(dx=-4, lean=-0.4, hand_f=(3, -9), hand_b=(-6, -9), mic_ang=-2.4, face="ko", mouth="open"), {}),
        (dict(dx=-8, lean=-0.6, hop=3, hand_f=(2, -9), hand_b=(-6, -9), mic="free", mic_at=(10, -30, -0.5), face="ko", mouth="open"),
         dict(rotate=-0.5, pivot=(40, FLOOR))),
        (dict(dx=-10, squash=0.9, hand_f=(4, -8), hand_b=(-6, -8), mic="free", mic_at=(14, -12, 2.6), face="ko", mouth="open"),
         dict(rotate=-1.2, pivot=(38, FLOOR), fit=True)),
        (dict(dx=-10, squash=0.9, hand_f=(6, -6), hand_b=(-6, -7), mic=None, face="ko", mouth="flat"),
         dict(rotate=-1.5, pivot=(38, FLOOR), fit=True)),
    ]
    win = [
        pip(hand_f=(4, -11), hand_b=(-7, -9), mic_ang=-1.5, face="happy", mouth="open"),
        pip(hop=7, tuck=0.4, hand_f=(3, -12), hand_b=(-6, -10), mic_ang=-1.6, face="happy", mouth="open"),
        pip(hop=10, tuck=0.6, hand_f=(4, -12), hand_b=(-6, -10), mic_ang=-1.4, face="happy", mouth="open"),
        pip(hop=3, hand_f=(5, -10), hand_b=(-7, -8), mic_ang=-1.5, face="happy", mouth="smile"),
    ]
    return [
        [(p, {}) for p in idle],
        [(p, {}) for p in walk],
        [(p, {}) for p in attack],
        [(p, {}) for p in hurt],
        [(pip(**kw), opts) for kw, opts in ko_poses],
        [(p, {}) for p in win],
    ]


if __name__ == "__main__":
    img = sheet(rows(), PAL, 1.25)  # a touch bigger than the 96-pixel grid, drawn with more pixels
    out = os.path.join(os.path.dirname(__file__), "..", "..", "art", "sprites", "pip_v1.png")
    img.save(out)
    big = img.resize((img.width * 3, img.height * 3), 0)
    print("wrote pip", img.size)
