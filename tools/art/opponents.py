"""The built-in opponents, finished-style sprite sheets on the shared rig.

Usage: python3 tools/art/opponents.py [id ...]   (writes src/assets/opponents/<id>.png)
"""
import math, os, sys
from rig import (Body, Part, along, capsule, ellipse, eye, humanoid_sheet, in_poly, local, poly_at, ramp, rot,
                 sheet, FLOOR)

SKIN = ramp("#f8cfa0", "#e3a274", "#bd7650", "#8c5036")
SKIN_TAN = ramp("#e8b07c", "#c98a5a", "#9c6440", "#6c4028")
SKIN_DARK = ramp("#c88a5e", "#9c6440", "#734528", "#4c2c18")
DARK = ramp("#4a3f5c", "#2e2640", "#221c30", "#17121f")
WHITE = ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99")
STEEL = ramp("#f4f6ff", "#b8bfd6", "#7f87a3", "#4f5670")


def base_pal(**more):
    pal = dict(skin=SKIN, dark=DARK, white=WHITE, steel=STEEL)
    pal.update(more)
    return pal


def brows(lx, ly, ex, ey, ew, angry=True):
    """A thick brow over an eye (angry ones slope down toward the nose)."""
    slope = 0.35 if angry else -0.1
    y = ey - 3.6 + (lx - ex) * slope * (1 if ex > 0 else -1)
    return abs(lx - ex) < ew + 0.6 and abs(ly - y) < 0.9


# ── Dock Goon: a dockhand in a beanie and a striped tank top ────────────
class DockGoon(Body):
    R = dict(Body.R, thigh=(7.8, 6.4), upper=(6.2, 5.2), fist=6.0)

    def thigh(self, t, s, side):
        return "pants"

    def shin(self, t, s, side):
        return "pants" if t < 0.6 else "boot"

    def torso(self, lx, ly):
        if ly > -4:
            return "belt" if ly < -1.5 else "pants"
        if ly < -17 and ((lx - 1) / 7.5) ** 2 + ((ly + 26) / 9) ** 2 <= 1:
            return "skin"
        if ly < -19 and (lx < -9 or lx > 10):
            return "skin"
        return "stripe" if int((ly + 40) // 3.2) % 2 == 0 else "shirt"

    def head(self, lx, ly, face):
        if ly < -3.5:
            return "hat" if ly > -5.6 or int((lx + 20) // 2.4) % 2 else "hat2"
        e = eye(lx, ly, 6.3, 1.5, 2.2, 2.4, face, white=False) or eye(lx, ly, -1.8, 1.5, 1.8, 2.4, face, white=False)
        if e:
            return e
        if brows(lx, ly, 6.3, 1.5, 2.2) or brows(lx, ly, -1.8, 1.5, 1.8):
            return "hair"
        if ly > 6.5 and ((lx - 4) / 7.5) ** 2 + ((ly - 9) / 4) ** 2 <= 1:
            if 9.2 < ly < 10.4 and 3 < lx < 8.5:
                return "dark"
            return "stubble"
        if 9.8 < lx < 12 and -1 < ly < 5:
            return "skin"  # nose bump
        return "skin"

    def head_in(self, lx, ly):
        if 9.5 < lx < 12.2 and -0.5 < ly < 5:  # the nose
            return True
        return Body.head_in(self, lx, ly)


# ── Spiky Bouncer: black tee, shades, a red mohawk and spiked shoulders ─
class SpikyBouncer(Body):
    R = dict(Body.R, thigh=(8.0, 6.6), upper=(6.6, 5.4), fore=(5.4, 5.0), fist=6.2)
    TORSO_POLY = [(-13, 0), (-14.5, -9), (-16.5, -18), (-15, -24.5), (15.5, -24.5), (17, -18), (14.5, -9), (13, 0)]

    def thigh(self, t, s, side):
        return "jeans"

    def shin(self, t, s, side):
        return "jeans" if t < 0.55 else "boot"

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "boot"

    def torso(self, lx, ly):
        if ly > -4:
            return "steel" if ly < -1.5 and abs(lx - 1) < 2 else ("dark" if ly < -1.5 else "jeans")
        if ly < -19 and abs(lx - 1) < 4.5 and ly > -23:
            return "skin"
        # STAFF in white letters is too small: a white band instead
        if -15 < ly < -12:
            return "white"
        return "tee"

    def upper(self, t, s, side):
        return "tee" if t < 0.35 else "skin"

    def fore(self, t, s, side):
        return "steel" if t > 0.65 else "skin"  # spiked bracers

    def head(self, lx, ly, face):
        # shades over both eyes
        if -0.5 < ly < 3.6 and -4.5 < lx < 10.5 and not (2.2 < lx < 3.2 and ly > 0.8):
            if face == "hurt" or face == "ko":
                e = eye(lx, ly, 6.3, 1.6, 2.4, 2.4, face, white=False) or eye(lx, ly, -1.8, 1.6, 2.0, 2.4, face, white=False)
                return e or "skin"
            return "shades" if not (lx > 6.5 and ly < 0.8) else "steel"
        if ly < -7.5 and abs(lx) < 4.5:
            return "mohawk"
        if 8.5 < ly < 10 and 3 < lx < 9:
            return "dark"
        return "skin"

    def extras(self, j, p, parts):
        ha, hc = j["head_ang"], j["head"]
        # mohawk spikes
        spikes = [(-5, -10), (-3.5, -16), (-1.5, -11), (0.5, -18), (2.5, -12), (4.5, -17), (6, -10)]
        pts = poly_at(hc, ha, spikes, self.HEAD_S, self.HEAD_S)
        parts.append(Part("mohawk", 5.9, lambda x, y: in_poly(x, y, pts), lambda x, y: ("mohawk", 0), light=3, rim=1.2))
        # a spiked collar under the jaw, spikes all round
        n, lean = j["neck"], j["lean"]
        cc = (n[0] + rot(1.5, -2, lean)[0], n[1] + rot(1.5, -2, lean)[1])
        parts.append(Part("collar", 6.3, ellipse(cc, 10.5, 3.6, lean), lambda x, y: ("steel", 0), light=2.5, rim=1))
        for k, ox in enumerate((-8, -3, 2.5, 8)):
            base_ = (cc[0] + rot(ox, 2.5, lean)[0], cc[1] + rot(ox, 2.5, lean)[1])
            tip = (cc[0] + rot(ox * 1.25, 8, lean)[0], cc[1] + rot(ox * 1.25, 8, lean)[1])
            parts.append(Part(f"cspike{k}", 6.25, capsule(base_, tip, 1.9, 0.3), lambda x, y: ("steel", 0), light=1.4, rim=0.8))
        # spikes on the front bracer
        e, h = j["elbow_front"], j["hand_front"]
        for k, t in enumerate((0.7, 0.88)):
            bx, by = e[0] + (h[0] - e[0]) * t, e[1] + (h[1] - e[1]) * t
            ang = math.atan2(h[1] - e[1], h[0] - e[0]) - math.pi / 2
            tip = (bx + math.cos(ang) * 7, by + math.sin(ang) * 7)
            parts.append(Part(f"bspike{k}", 7.25, capsule((bx, by), tip, 2.0, 0.3), lambda x, y: ("steel", 0), light=1.4, rim=0.8))


# ── Ringside Bruiser: bald, goatee, red singlet, a big gut ──────────────
class RingsideBruiser(Body):
    R = dict(Body.R, thigh=(8.6, 7.0), shin=(6.8, 7.2), upper=(7.0, 5.8), fore=(5.8, 5.4), fist=6.6)
    TORSO_POLY = [(-13, 0), (-15.5, -8), (-16.5, -17), (-14.5, -24.5), (15, -24.5), (18.5, -16), (19, -7), (14, 0)]
    HEAD_S = 1.25
    SHOULDER = (11, 9.5)

    def thigh(self, t, s, side):
        return "singlet" if t < 0.45 else "skin"

    def shin(self, t, s, side):
        return "pad" if t < 0.2 else ("skin" if t < 0.4 else "boot")

    def torso(self, lx, ly):
        if ly > -4:
            return "singlet"
        if ly < -14 and not (-8 < lx < -4 or 6 < lx < 10):
            return "skin"  # straps over a bare chest
        if ly < -14:
            return "singlet"
        return "singlet"

    def upper(self, t, s, side):
        return "skin"

    def fore(self, t, s, side):
        return "pad" if 0.0 < t < 0.3 else "skin"  # elbow pads

    def fist(self, side):
        return "tape"

    def head(self, lx, ly, face):
        e = eye(lx, ly, 6.5, 0.5, 2.3, 2.2, face, white=False) or eye(lx, ly, -1.6, 0.5, 1.8, 2.2, face, white=False)
        if e:
            return e
        if brows(lx, ly, 6.5, 0.5, 2.3) or brows(lx, ly, -1.6, 0.5, 1.8):
            return "dark"
        if ly > 7.5 and abs(lx - 5) < 3.5:
            return "beard"  # goatee
        if 6 < ly < 7.2 and 2.5 < lx < 9.5:
            return "beard"  # moustache
        if 7.5 < ly < 8.5 and 3 < lx < 8 and face != "happy":
            return "dark"
        return "skin"

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "boot"


# ── Corner Medic: a cap with a cross, a polo, a towel round the neck ────
class CornerMedic(Body):
    R = dict(Body.R, thigh=(6.8, 5.6), shin=(5.6, 6.0), upper=(5.4, 4.6), fore=(4.6, 4.2), fist=5.0)
    TORSO_POLY = [(-11, 0), (-12, -9), (-13, -18), (-12, -24), (12.5, -24), (13.5, -18), (12, -9), (11, 0)]

    def thigh(self, t, s, side):
        return "scrubs"

    def shin(self, t, s, side):
        return "scrubs" if t < 0.7 else "white"

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "white"

    def torso(self, lx, ly):
        if ly > -4:
            return "scrubs"
        if ly < -19 and abs(lx - 1) < 3.5:
            return "skin"
        # a red cross on the chest
        if (abs(lx - 5.5) < 1.2 and -16 < ly < -10) or (abs(ly + 13) < 1.2 and 2.5 < lx < 8.5):
            return "cross"
        return "polo"

    def upper(self, t, s, side):
        return "polo" if t < 0.45 else "skin"

    def fore(self, t, s, side):
        return "skin"

    def fist(self, side):
        return "glove"

    def head(self, lx, ly, face):
        if ly < -3:
            if abs(lx - 3) < 1 and -10 < ly < -5 or abs(ly + 7.5) < 1 and 0.5 < lx < 5.5:
                return "cross"
            return "cap"
        e = eye(lx, ly, 6.3, 1.8, 2.3, 2.6, face) or eye(lx, ly, -1.8, 1.8, 1.8, 2.6, face)
        if e:
            return e
        if ly > 7.5 and 3.5 < lx < 8 and ly < 9 + (0.6 if face == "happy" else 0):
            return "dark" if face != "happy" else "mouth"
        return "skin"

    def extras(self, j, p, parts):
        ha, hc = j["head_ang"], j["head"]
        # the cap's bill, toward the front
        bill = poly_at(hc, ha, [(4, -4.5), (17, -3.5), (17, -1.5), (4, -2)], self.HEAD_S, self.HEAD_S)
        parts.append(Part("bill", 6.1, lambda x, y: in_poly(x, y, bill), lambda x, y: ("cap", 1), light=2, rim=1))
        # a towel draped over the shoulders
        n = j["neck"]
        towel = poly_at(n, j["lean"], [(-12, 2), (-6, -2), (6, -2), (13, 2), (12, 7), (6, 4), (-6, 4), (-12, 8)])
        parts.append(Part("towel", 4.8, lambda x, y: in_poly(x, y, towel), lambda x, y: ("towel", 0), light=3))


# ── Tugboat Tony (big): captain's hat, a big beard, a life-vest singlet ─
class TugboatTony(Body):
    R = dict(Body.R, thigh=(9.0, 7.4), shin=(7.4, 8.0), foot=(6.4, 5.4), upper=(7.4, 6.2), fore=(6.4, 6.0), fist=7.2)
    TORSO_POLY = [(-14, 0), (-17, -8), (-18, -17), (-16, -25), (16, -25), (20, -16), (20.5, -6), (15, 0)]
    SHOULDER = (12, 10)
    HEAD_S = 1.22

    def thigh(self, t, s, side):
        return "pants"

    def shin(self, t, s, side):
        return "pants" if t < 0.45 else "rubber"

    def foot(self, t, s, side):
        return "dark" if s > 2.6 else "rubber"

    def torso(self, lx, ly):
        if ly > -4:
            return "belt" if ly < -1.5 else "pants"
        if ly < -18 and abs(lx - 1) < 6:
            return "beard"
        # the vest's white straps and buckles
        if abs(lx - 1) < 1.6 and -18 < ly < -4:
            return "white"
        if abs(ly + 10) < 1.2:
            return "white"
        return "vest"

    def upper(self, t, s, side):
        return "skin"

    def fore(self, t, s, side):
        # an anchor tattoo on the front forearm
        if side == "front" and 0.35 < t < 0.65 and abs(s) < 1.6:
            return "tattoo"
        return "skin"

    def head(self, lx, ly, face):
        if ly < -4.5:
            if -6.2 < ly < -4.5:
                return "hatband"
            if abs(lx - 3) < 1.8 and -11 < ly < -7.5:
                return "badge"
            return "hat"
        e = eye(lx, ly, 6.3, 0.8, 2.1, 2.2, face, white=False) or eye(lx, ly, -1.6, 0.8, 1.7, 2.2, face, white=False)
        if e:
            return e
        if brows(lx, ly, 6.3, 0.8, 2.1, angry=False) or brows(lx, ly, -1.6, 0.8, 1.7, angry=False):
            return "beard"
        if ly > 4.2:
            if 6.5 < ly < 8 and 3.5 < lx < 9:
                return "dark" if face != "happy" else "mouth"
            return "beard"
        if 9.8 < lx and -0.5 < ly < 4.5:
            return "nose"
        return "skin"

    def head_in(self, lx, ly):
        if 9.5 < lx < 12.8 and -0.5 < ly < 4.5:
            return True
        if ly > 3 and ly < 16 and ((lx - 1.5) / 11) ** 2 + ((ly - 4) / 11.5) ** 2 <= 1:
            return True  # the beard hangs below the jaw
        return Body.head_in(self, lx, ly)

    def extras(self, j, p, parts):
        ha, hc = j["head_ang"], j["head"]
        bill = poly_at(hc, ha, [(-4, -4.6), (13.5, -4.2), (13.5, -2.6), (-4, -3)], self.HEAD_S, self.HEAD_S)
        parts.append(Part("bill", 6.1, lambda x, y: in_poly(x, y, bill), lambda x, y: ("dark", 0), light=2, rim=1))


# ── The Rafter King (big): a purple and gold mask, a crown and a cape ───
class RafterKing(Body):
    R = dict(Body.R, thigh=(7.8, 6.2), shin=(6.2, 6.8), upper=(6.2, 5.2), fore=(5.2, 4.8), fist=6.0)
    TORSO_POLY = [(-12.5, 0), (-14, -9), (-15.5, -18), (-14, -24), (14.5, -24), (16, -18), (14, -9), (12.5, 0)]

    def thigh(self, t, s, side):
        return "tights"

    def shin(self, t, s, side):
        return "gold" if t < 0.14 else ("tights" if t < 0.48 else "boot")

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "boot"

    def torso(self, lx, ly):
        if ly > -5.5:
            if ly < -1.5:
                return "gold" if not (abs(lx - 1) < 3 and ly > -5) else "gem"
            return "tights"
        return "skin"

    def upper(self, t, s, side):
        return "gold" if t < 0.18 else "skin"

    def fore(self, t, s, side):
        return "gold" if t > 0.6 else "skin"

    def fist(self, side):
        return "skin"

    def head(self, lx, ly, face):
        for ex, ew in ((6.0, 3.4), (-2.8, 2.4)):
            ey = 2.0 - (lx - ex) * (0.2 if ex > 0 else -0.2)
            dx, dy = (lx - ex) / (ew + 1.6), (ly - ey) / 4.4
            if dx * dx + dy * dy <= 1:
                if ((lx - ex) / ew) ** 2 + ((ly - ey) / 2.9) ** 2 > 1:
                    return "gold"
                return eye(lx, ly, ex, ey, ew, 2.9, face) or "skin"
        if 4 < lx < 9.5 and 7.5 < ly < 11:
            if 8.6 < ly < 10 and 5 < lx < 8.8:
                return "dark" if face != "happy" else "mouth"
            return "skin"
        # a gold diamond on the forehead
        if abs(lx - 2) + abs(ly + 6) * 0.8 < 3:
            return "gem"
        return "mask"

    def extras(self, j, p, parts):
        ha, hc = j["head_ang"], j["head"]
        crown = poly_at(hc, ha, [(-8, -9), (-8, -16), (-5, -12.5), (-1.5, -18), (2, -12.5), (5.5, -18), (8.5, -12.5), (11, -15.5), (10, -8.5)],
                        self.HEAD_S, self.HEAD_S)
        parts.append(Part("crown", 6.2, lambda x, y: in_poly(x, y, crown), lambda x, y: ("gold", 0), light=3, rim=1.2))
        # the cape: from the shoulders, behind everything, swaying a little
        n, lean = j["neck"], j["lean"]
        sway = p.get("cape", 0)
        cape = poly_at(n, lean, [(-12, 3), (8, 3), (4 + sway * 0.3, 40), (-10 + sway, 46), (-22 + sway, 42)])
        parts.append(Part("cape", -1, lambda x, y: in_poly(x, y, cape), lambda x, y: ("cape", 0), light=5))
        collar = poly_at(n, lean, [(-13, 4), (-15, -5), (-8, 0), (8, 0), (11, -4), (10, 4)])
        parts.append(Part("collar", 5.5, lambda x, y: in_poly(x, y, collar), lambda x, y: ("gold", 0), light=2, rim=1))


# ── Agent Brick (huge): a black suit, shades, a flat-top ────────────────
class AgentBrick(Body):
    R = dict(Body.R, thigh=(8.2, 7.0), shin=(7.0, 7.4), foot=(6.0, 5.2), upper=(7.6, 6.4), fore=(6.4, 6.0), fist=7.0)
    TORSO_POLY = [(-13, 0), (-15.5, -9), (-18.5, -18), (-17.5, -25), (18, -25), (19.5, -18), (16, -9), (13.5, 0)]
    SHOULDER = (12.5, 11)
    HEAD_S = 1.12
    NECK_R = 6.2

    def thigh(self, t, s, side):
        return "suit"

    def shin(self, t, s, side):
        return "suit"

    def foot(self, t, s, side):
        return "dark" if s > 2.4 else "shoe"

    def torso(self, lx, ly):
        if ly > -3:
            return "suit"
        # shirt and tie in the jacket's V
        v = abs(lx - 1.5)
        if ly < -5 and v < (ly + 25) * 0.32:
            if v < 1.3 and ly > -21:
                return "tie"
            return "shirt"
        if abs(lx - 1.5) < 0.6:
            return "dark"  # the jacket's front edge
        return "suit"

    def upper(self, t, s, side):
        return "suit"

    def fore(self, t, s, side):
        return "shirt" if t > 0.85 else "suit"

    def fist(self, side):
        return "skin"

    def head(self, lx, ly, face):
        if ly < -6.5:
            return "hair"
        if -0.5 < ly < 3.2 and -5 < lx < 11:
            if face in ("hurt", "ko"):
                e = eye(lx, ly, 6.5, 1.4, 2.3, 2.2, face, white=False) or eye(lx, ly, -1.8, 1.4, 1.9, 2.2, face, white=False)
                return e or "skin"
            return "steel" if (lx > 7 and ly < 0.8) else "shades"
        if 7.6 < ly < 8.8 and 3 < lx < 9:
            return "dark"
        return "skin"

    def head_in(self, lx, ly):
        # a square jaw and a flat top
        if ly < -11.5:
            return False
        return -10.5 < lx < 11 and -11.5 <= ly < 12 and not (ly > 8 and (lx < -6 or lx > 9.5))


# ── the gull and the dummy are built their own way ──────────────────────

def gull_sheet():
    """The Gull Flyer: a seagull in a red bandana, always in the air."""
    pal = dict(white=WHITE, wing=ramp("#d9deea", "#a7aec4", "#767e98", "#4b5168"), beak=ramp("#ffe48a", "#f6b93b", "#d98a1d", "#a35f13"),
               leg=ramp("#ffb27a", "#f08a3c", "#c0601e", "#7e3a10"), band=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"),
               dark=DARK, tip=ramp("#4a4458", "#2e2a3a", "#221e2c", "#171420"))

    def bird(flap=0.0, tilt=0.0, dx=0.0, dy=0.0, face="normal", dive=0.0, beak_open=0.0):
        c = (46 + dx, 72 + dy)  # feet near the frame bottom, like a fighter standing on air
        a = tilt + dive
        parts = []
        body = ellipse(c, 15, 10, a)
        bl = local(c, a)

        def body_mat(x, y):
            lx, ly = bl(x, y)
            if lx < -10:
                return ("tip", 0) if ly < 1 else ("white", 0)  # tail
            return ("white", 0)
        parts.append(Part("body", 3, body, body_mat, light=5))
        tail = poly_at(c, a, [(-12, -3), (-24, -6), (-22, 2), (-12, 4)])
        parts.append(Part("tail", 2.5, lambda x, y: in_poly(x, y, tail), lambda x, y: ("tip", 0), light=2))
        hc = (c[0] + rot(14, -9, a)[0], c[1] + rot(14, -9, a)[1])
        hl = local(hc, a)
        parts.append(Part("head", 5, ellipse(hc, 8.5, 8, a), lambda x, y: head_mat(*hl(x, y)), light=4))

        def head_mat(lx, ly):
            e = eye(lx, ly, 3.5, -1.5, 2.0, 2.4, face)
            if e:
                return (e, 0)
            if -5.5 < ly < -3.2 and lx < 5:
                return ("band", 0)
            return ("white", 0)
        # the bandana's knot trailing behind
        knot = poly_at(hc, a, [(-6, -5), (-14, -9 + flap * 2), (-13, -2 + flap * 2), (-6, -2)])
        parts.append(Part("knot", 4.8, lambda x, y: in_poly(x, y, knot), lambda x, y: ("band", 0), light=2))
        bo = beak_open
        beak_top = poly_at(hc, a, [(6, -2), (17, 0.5), (6, 2)])
        beak_bot = poly_at(hc, a, [(6, 1.5), (15, 2.5 + bo * 3), (6, 4)])
        parts.append(Part("beak", 5.5, lambda x, y: in_poly(x, y, beak_top) or in_poly(x, y, beak_bot), lambda x, y: ("beak", 0), light=2, rim=1))
        # legs tucked under
        for k, z in ((-1, 2), (1, 2.2)):
            hipp = (c[0] + rot(2 + k * 3, 8, a)[0], c[1] + rot(2 + k * 3, 8, a)[1])
            footp = (hipp[0] - 4 + k, hipp[1] + 9)
            parts.append(Part(f"leg{k}", z, capsule(hipp, footp, 1.6, 1.4), lambda x, y: ("leg", 0), light=1, rim=0.6))
            parts.append(Part(f"foot{k}", z, capsule(footp, (footp[0] + 4, footp[1] + 1), 1.8, 1.4), lambda x, y: ("leg", 0), light=1, rim=0.6))
        # wings: shoulder at the back, flapping (−1 up … +1 down)
        for side, z, dim in (("back", 1, 1), ("front", 7, 0)):
            sh = (c[0] + rot(2 if side == "front" else 4, -5, a)[0], c[1] + rot(2 if side == "front" else 4, -5, a)[1])
            ang = a - math.pi * 0.62 - flap * 0.9 + (0.12 if side == "back" else 0)
            span = 30
            tipp = (sh[0] + math.cos(ang) * span, sh[1] + math.sin(ang) * span)
            mid = (sh[0] + math.cos(ang + 0.25) * span * 0.5, sh[1] + math.sin(ang + 0.25) * span * 0.5)
            wl = along(sh, tipp)

            def wing_mat(x, y, wl=wl, dim=dim):
                t, s = wl(x, y)
                return ("tip" if t > 0.78 else "wing", dim)
            wing = poly_at((0, 0), 0, [sh, mid, tipp, (tipp[0] - math.cos(ang) * 6 + 5, tipp[1] - math.sin(ang) * 6 + 3),
                                       (mid[0] + 6, mid[1] + 6), (sh[0] + 8, sh[1] + 5)])
            parts.append(Part(f"wing_{side}", z, lambda x, y, w=wing: in_poly(x, y, w), wing_mat, light=3, rim=1.2))
        return parts

    rows = []
    rows.append([(bird(flap=f, dy=b), {}) for f, b in ((-1, 0), (-0.3, 1), (0.8, 2), (0.2, 1))])
    rows.append([(bird(flap=math.sin(i / 8 * 6.28) * 1.1, dy=math.cos(i / 8 * 6.28) * 1.5, tilt=0.08), {}) for i in range(8)])
    rows.append([(bird(flap=-1, tilt=-0.3, dx=-4, dy=-4, beak_open=1), {}), (bird(flap=-0.6, tilt=-0.35, dx=-6, dy=-6, beak_open=1), {}),
                 (bird(flap=0.9, dive=0.55, dx=8, dy=6), {}), (bird(flap=1, dive=0.6, dx=12, dy=8), {}),
                 (bird(flap=0.3, dive=0.3, dx=6, dy=4), {}), (bird(flap=0, dx=1, dy=1), {})])
    rows.append([(bird(flap=-1, tilt=-0.45, dx=-6, dy=-2, face="hurt", beak_open=1), {}), (bird(flap=-0.3, tilt=-0.3, dx=-4, face="hurt", beak_open=0.6), {}),
                 (bird(flap=0.4, tilt=-0.1, dx=-1, face="hurt"), {})])
    rows.append([(bird(flap=-1, tilt=-0.5, dy=0, face="ko", beak_open=1), {}), (bird(flap=-0.2, tilt=-1.4, dy=14, face="ko"), dict(fit=True)),
                 (bird(flap=0.6, tilt=-2.6, dy=30, face="ko"), dict(fit=True)), (bird(flap=1, tilt=-3.14, dy=34, face="ko"), dict(fit=True))])
    rows.append([(bird(flap=f, dy=-2 * k, face="happy", beak_open=1), {}) for k, f in enumerate((-1, 0.8, -1, 0.8))])
    return sheet(rows, pal, 1.0)


def dummy_sheet():
    """The Sparring Dummy: a stitched canvas dummy on a spring."""
    pal = dict(canvas=ramp("#f3e4c0", "#d9c08a", "#b09460", "#7c6538"), red=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"),
               steel=STEEL, dark=DARK, stitch=ramp("#6c5a3a", "#4e3f26", "#3a2e1a", "#261d10"), wood=ramp("#c99a6a", "#9c6e44", "#734e2c", "#4c3018"))

    def dummy(lean=0.0, hop=0.0, squash=1.0, arm=0.0, face="normal", dx=0.0):
        parts = []
        base = (48 + dx, FLOOR - 2)
        parts.append(Part("base", 1, ellipse(base, 14, 3.5), lambda x, y: ("wood", 0), light=2))
        spring_top = (base[0] + rot(0, -14 * squash, lean)[0], base[1] - 3 - 14 * squash - hop)
        sp = along(base, spring_top)
        parts.append(Part("spring", 1.5, capsule((base[0], base[1] - 2), spring_top, 3.5, 3.5),
                          lambda x, y: ("steel" if int(sp(x, y)[0] * 7) % 2 == 0 else "dark", 0), light=2))
        c = (spring_top[0] + rot(0, -20, lean)[0], spring_top[1] + rot(0, -20, lean)[1])
        bl = local(c, lean)

        def body_mat(x, y):
            lx, ly = bl(x, y)
            r = math.hypot(lx - 2, ly + 1)
            if r < 3:
                return ("red", 0)
            if 5.5 < r < 7.5:
                return ("red", 0)
            if abs(lx + 1) < 0.5 and int(ly) % 3 == 0:
                return ("stitch", 0)
            return ("canvas", 0)
        parts.append(Part("body", 3, ellipse(c, 15, 20 * (2 - squash) * 0.5 + 10 * squash - 10 + 10, lean), body_mat, light=5))
        hc = (c[0] + rot(1, -25, lean)[0], c[1] + rot(1, -25, lean)[1])
        hl = local(hc, lean)

        def head_mat(x, y):
            lx, ly = hl(x, y)
            for ex in (5, -2):
                if face == "happy":
                    if abs(ly + 0.5 - ((lx - ex) / 2) ** 2) < 0.8 and abs(lx - ex) < 2.2:
                        return ("stitch", 0)
                elif abs(abs(lx - ex) - abs(ly + 1)) < 0.7 and abs(lx - ex) < 2:
                    return ("stitch", 0)  # X-stitched eyes
            if 5 < ly < 6.4 and -1 < lx < 8:
                return ("stitch", 0)
            return ("canvas", 0)
        parts.append(Part("head", 6, ellipse(hc, 10, 10, lean), head_mat, light=4.5))
        for side, z, k in (("back", 2, -1), ("front", 7, 1)):
            sh = (c[0] + rot(9 * k, -10, lean)[0], c[1] + rot(9 * k, -10, lean)[1])
            ang = lean + (0.5 if side == "front" else 2.6) - arm * (1.2 if side == "front" else -0.3)
            tip = (sh[0] + math.cos(ang) * 13, sh[1] + math.sin(ang) * 13)
            parts.append(Part(f"arm_{side}", z, capsule(sh, tip, 5, 5.5), lambda x, y, d=(0 if side == "front" else 1): ("canvas", d), light=3))
        return parts

    rows = [
        [(dummy(lean=l), {}) for l in (0, 0.04, 0, -0.04)],
        [(dummy(hop=abs(math.sin(i / 8 * 6.28)) * 5, squash=1 - 0.08 * (1 - abs(math.sin(i / 8 * 6.28))), lean=0.08), {}) for i in range(8)],
        [(dummy(lean=-0.25, arm=-0.3), {}), (dummy(lean=-0.35, arm=-0.5), {}), (dummy(lean=0.45, arm=1.0, dx=6), {}),
         (dummy(lean=0.5, arm=1.2, dx=8), {}), (dummy(lean=0.2, arm=0.5, dx=3), {}), (dummy(lean=0.05), {})],
        [(dummy(lean=-0.55, squash=0.85), {}), (dummy(lean=0.35, squash=0.9), {}), (dummy(lean=-0.12), {})],
        [(dummy(lean=-0.6), {}), (dummy(lean=-0.9, squash=0.8), {}), (dummy(lean=-1.2, squash=0.7), dict(fit=True)), (dummy(lean=-1.45, squash=0.7), dict(fit=True))],
        [(dummy(hop=h, arm=a, face="happy"), {}) for h, a in ((0, 0), (5, 0.8), (8, 1.2), (8, 1.2))],
    ]
    return sheet(rows, pal, 1.0)


# ── the cast ────────────────────────────────────────────────────────────

GUARD = dict(hx=0, hy=2, lean=0.1, fbx=-10, ffx=9, hb=(12.5, 7), zb=6.5, hf=(13, 9), eb=1, ef=1)
BRAWL = dict(hx=0, hy=2, lean=0.08, fbx=-10, ffx=10, hb=(8, 18), zb=0, hf=(10, 16), eb=1, ef=-1)


def cast():
    hair = ramp("#6c5a4a", "#4a3a30", "#352820", "#221812")
    return {
        "dock_goon": (DockGoon(), base_pal(
            skin=SKIN_TAN, pants=ramp("#5a7ab8", "#3d5590", "#2a3c6a", "#1b2848"), shirt=ramp("#ffffff", "#e6e2ec", "#b5aec4", "#7e7690"),
            stripe=ramp("#7c8fd0", "#4f63a8", "#36477c", "#232f54"), belt=ramp("#9c7a52", "#6e5234", "#4e3822", "#322214"),
            boot=ramp("#a07a56", "#76563a", "#563c26", "#382616"), hat=ramp("#5ad0b8", "#2f9c88", "#1f7062", "#134a40"),
            hat2=ramp("#4ab8a2", "#258877", "#185f53", "#0f3f37"), hair=hair, stubble=ramp("#c99e7a", "#a07c5e", "#7c5c44", "#56402c"),
        ), 1.0, BRAWL),
        "spiky_bouncer": (SpikyBouncer(), base_pal(
            skin=SKIN_DARK, jeans=ramp("#5a6a90", "#3c4a6c", "#2a344e", "#1b2234"), tee=ramp("#4a4458", "#2c2838", "#201d2a", "#15131c"),
            boot=ramp("#4a4458", "#2c2838", "#201d2a", "#15131c"), shades=ramp("#3a3448", "#1e1a28", "#16131e", "#0e0c14"),
            mohawk=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"),
        ), 1.0, BRAWL),
        "ringside_bruiser": (RingsideBruiser(), base_pal(
            skin=SKIN, singlet=ramp("#ff7a72", "#d8314b", "#a01f36", "#621226"), pad=ramp("#5a5468", "#3a3448", "#2a2536", "#1b1724"),
            boot=ramp("#5a5468", "#3a3448", "#2a2536", "#1b1724"), beard=hair, tape=ramp("#ffffff", "#f1eee6", "#c9c2b4", "#8f8778"),
        ), 1.0, dict(BRAWL, hb=(9, 16), hf=(12, 14))),
        "corner_medic": (CornerMedic(), base_pal(
            skin=SKIN, scrubs=ramp("#7ee0b8", "#3fb88c", "#2a8a68", "#1a5c46"), polo=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
            cross=ramp("#ff7a72", "#e2343f", "#aa2131", "#6f1522"), cap=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
            towel=ramp("#ffe48a", "#f6c94b", "#d9a020", "#a37513"), glove=ramp("#c8f0ff", "#8fd4f0", "#5aa8c8", "#3a7a96"),
            mouth=ramp("#a8344a", "#7c2236", "#5a1826", "#3a0e18"),
        ), 1.0, dict(GUARD, hb=(10, 14), zb=0, hf=(11, 14), ef=-1)),
        "tugboat_tony": (TugboatTony(), base_pal(
            skin=SKIN, pants=ramp("#4a5a8a", "#2f3c66", "#222c4a", "#161d32"), vest=ramp("#ffb27a", "#f07a2c", "#c0561a", "#7e3410"),
            rubber=ramp("#ffec8a", "#f6cf3b", "#d9a41d", "#a37513"), belt=ramp("#6c5a4a", "#4a3a30", "#352820", "#221812"),
            beard=ramp("#f0f0f4", "#cfd0dc", "#9a9cb0", "#686a80"), hat=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
            hatband=ramp("#4a5a8a", "#2f3c66", "#222c4a", "#161d32"), badge=ramp("#ffe48a", "#f6b93b", "#d98a1d", "#a35f13"),
            nose=ramp("#ffb0a0", "#ec8a78", "#c0604e", "#8c3e30"), tattoo=ramp("#6a8ad8", "#4a64b0", "#344884", "#22305a"),
            mouth=ramp("#a8344a", "#7c2236", "#5a1826", "#3a0e18"),
        ), 1.5, dict(BRAWL, hb=(9, 15), hf=(12, 13))),
        "rafter_king": (RafterKing(), base_pal(
            skin=SKIN_TAN, tights=ramp("#c08aff", "#8a4fe0", "#6234a8", "#3e1f70"), mask=ramp("#c08aff", "#8a4fe0", "#6234a8", "#3e1f70"),
            gold=ramp("#fff2a0", "#f6c94b", "#d4981e", "#9a6812"), gem=ramp("#9ff0ff", "#3fc8f0", "#2090c0", "#105c84"),
            boot=ramp("#c08aff", "#8a4fe0", "#6234a8", "#3e1f70"), cape=ramp("#ff7a92", "#d8314b", "#a01f36", "#621226"),
            mouth=ramp("#a8344a", "#7c2236", "#5a1826", "#3a0e18"),
        ), 1.5, dict(GUARD, hb=(10, 12), zb=0, hf=(13, 8))),
        "agent_brick": (AgentBrick(), base_pal(
            skin=SKIN_TAN, suit=ramp("#4a4458", "#2c2838", "#201d2a", "#15131c"), shirt=ramp("#ffffff", "#ece8f4", "#bdb4cf", "#857c99"),
            tie=ramp("#ff7a72", "#d8314b", "#a01f36", "#621226"), shoe=ramp("#3a3448", "#1e1a28", "#16131e", "#0e0c14"),
            hair=ramp("#5a4a40", "#3a2c24", "#2a1f18", "#1a120c"), shades=ramp("#3a3448", "#1e1a28", "#16131e", "#0e0c14"),
        ), 2.5, dict(BRAWL, hb=(8, 18), hf=(9, 18), lean=0.04, reach=0.55, hx=-3)),
    }


def write(name, img):
    out = os.path.join(os.path.dirname(__file__), "..", "..", "src", "assets", "opponents", f"{name}.png")
    os.makedirs(os.path.dirname(out), exist_ok=True)
    img.save(out)
    print("wrote", name, img.size)


if __name__ == "__main__":
    want = set(sys.argv[1:])
    for name, (body, pal, scale, base) in cast().items():
        if not want or name in want:
            write(name, humanoid_sheet(body, pal, scale, base))
    if not want or "gull_flyer" in want:
        write("gull_flyer", gull_sheet())
    if not want or "sparring_dummy" in want:
        write("sparring_dummy", dummy_sheet())
