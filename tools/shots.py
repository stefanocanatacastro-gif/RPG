"""Quick screenshots of every screen (for layout work). Usage: python3 tools/shots.py OUTDIR"""
import functools, http.server, os, sys, threading
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "shots"
os.makedirs(out, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory="dist"))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"
errors = []


def wait_scene(page, key, timeout=10000):
    page.wait_for_function(f"window.__game && window.__game.scene.isActive('{key}')", timeout=timeout)
    page.wait_for_timeout(700)


def goto(page, key, data="{}"):
    page.evaluate(
        f"(() => {{ const g = window.__game; for (const s of g.scene.getScenes(true)) if (!['touch_controls','debug','transition'].includes(s.sys.settings.key)) g.scene.stop(s.sys.settings.key); g.scene.start('{key}', {data}); }})()"
    )
    wait_scene(page, key)


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])
    page = b.new_page(viewport={"width": 1920, "height": 1080})
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.goto(url)
    wait_scene(page, "title", 15000)
    page.screenshot(path=f"{out}/title.png")
    only = sys.argv[2].split(",") if len(sys.argv) > 2 else None
    for key in ["dev_hub", "battle_sandbox", "fighter_maker", "item_maker", "move_maker", "encounters", "gallery",
                "room_editor", "input_test", "ui_kit", "anim_test", "data_report", "game_over"]:
        if only and key not in only:
            continue
        try:
            goto(page, key)
            page.screenshot(path=f"{out}/{key}.png")
        except Exception as e:
            print("fail", key, e)
    if not only or "field" in only:
        goto(page, "field", "{ room: 'test_b', spawn: 'start' }")
        page.wait_for_timeout(600)
        page.screenshot(path=f"{out}/field.png")
    if not only or "battle" in only:
        goto(page, "battle_sandbox")
        page.evaluate("(() => { const s = window.__game.scene.getScene('battle_sandbox'); s.s.cond = { hazards: ['spotlight'], goal: 'survive', rounds: 3 }; s.pressRow('FIGHT', 'confirm'); })()")
        wait_scene(page, "battle")
        page.wait_for_function("window.__game.scene.getScene('battle').inputState === 'menu'", timeout=20000)
        page.wait_for_timeout(800)
        page.screenshot(path=f"{out}/battle_menu.png")
        page.keyboard.press("Enter")
        page.wait_for_timeout(500)
        page.screenshot(path=f"{out}/battle_target.png")
    print("errors:", errors[:5])
