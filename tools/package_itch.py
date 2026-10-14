"""Packs the public build for itch.io: release/kid-chispa-itch-<version>.zip with
index.html at the root (what itch.io runs), plus credits and licences.
Run through `npm run build:itch`, which makes release/itch/game first."""
import json, os, zipfile

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
version = json.load(open(os.path.join(root, "package.json")))["version"]
game = os.path.join(root, "release", "itch", "game")
out = os.path.join(root, "release", f"kid-chispa-itch-{version}.zip")

credits = f"""KID CHISPA: BATTLE MAKER  v{version}

Made by Stefano Canata.

Built with Phaser 3 (MIT License, (c) Richard Davey, Photon Storm Ltd).
Font: Press Start 2P by CodeMan38 (SIL Open Font License 1.1; full text below).

Battles you make and import are kept in your browser on this device.
Share them with SHARE (a .chispa.json file) and IMPORT.

----------------------------------------------------------------------
"""
ofl = open(os.path.join(root, "node_modules", "@fontsource", "press-start-2p", "LICENSE")).read()

index = os.path.join(game, "index.html")
assert os.path.exists(index), "build first: release/itch/game/index.html is missing"
html = open(index).read()
assert "__debug" not in html or "IS_DEV" not in html, "this looks like a dev build"

with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.write(index, "index.html")
    z.writestr("CREDITS.txt", credits + "Press Start 2P licence\n\n" + ofl)
print(f"{os.path.relpath(out, root)} ready ({os.path.getsize(out) // 1024} KB)")
