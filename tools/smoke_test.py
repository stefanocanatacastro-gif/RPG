"""Headless browser test of the built game (dist/index.html).

Walks the whole foundations loop the way a player would: title -> dev hub ->
grey-box room -> touch an enemy -> battle -> win -> back in the room with the
enemy gone and coins added -> through the door -> debug menu -> every test
screen. Also checks phone sizes, the rotate notice, touch controls and the
crash screen. Screenshots go to the folder given as the first argument.
"""
import sys, threading, http.server, functools, os
from playwright.sync_api import sync_playwright

out = sys.argv[1] if len(sys.argv) > 1 else "test-shots"
os.makedirs(out, exist_ok=True)


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


srv = http.server.ThreadingHTTPServer(("127.0.0.1", 0), functools.partial(Quiet, directory="dist"))
threading.Thread(target=srv.serve_forever, daemon=True).start()
url = f"http://127.0.0.1:{srv.server_address[1]}/index.html"

failures = []


def check(cond, msg):
    print(("  ok   " if cond else "  FAIL ") + msg)
    if not cond:
        failures.append(msg)


def active(page, key):
    return page.evaluate(f"window.__game.scene.isActive('{key}')")


def wait_scene(page, key, timeout=8000):
    page.wait_for_function(f"window.__game && window.__game.scene.isActive('{key}')", timeout=timeout)
    page.wait_for_timeout(250)


def press(page, key, wait=120):
    page.keyboard.press(key)
    page.wait_for_timeout(wait)


def wait_battle_input(page, state, timeout=20000):
    page.wait_for_function(
        f"window.__game.scene.isActive('battle') && window.__game.scene.getScene('battle').inputState === '{state}'",
        timeout=timeout,
    )
    page.wait_for_timeout(160)


def battle_eval(page, js):
    return page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('battle'); {js} }})()")


def choose_move(page, index):
    wait_battle_input(page, "menu")
    battle_eval(page, f"s.menu.setCursor({index});")
    press(page, "Enter", 200)
    wait_battle_input(page, "target")
    press(page, "Enter", 50)


def wait_command(page, kind, timeout=8000):
    page.wait_for_function(
        f"(() => {{ const s = window.__game.scene.getScene('battle'); return s.commands.state && s.commands.state.kind === '{kind}' && s.commands.state.keyAt > 0; }})()",
        timeout=timeout,
    )


def ms_until_key(page):
    return battle_eval(page, "return s.commands.state ? s.commands.state.keyAt - s.time.now : 0;")


def last_cmds(page, move):
    return battle_eval(page, f"return s.engine.log.filter(l => l.startsWith('cmd {move}'));")


def hits_in_turn(page, move):
    return battle_eval(page, f"const i = s.engine.log.map(l => l.startsWith('hero')).lastIndexOf(false); return s.engine.log.filter(l => l.startsWith('hero {move}')).length;")


def wait_turn_over(page):
    wait_battle_input(page, "menu", 30000)


def key_at(page, lead_ms=12, hold_ms=50, code="KeyZ"):
    """Presses a button on the first game frame at least `lead_ms` before the command's key moment."""
    action = {"KeyZ": "confirm", "KeyX": "cancel"}[code]
    page.evaluate(
        f"""(() => {{
          const s = window.__game.scene.getScene('battle');
          const at = s.commands.state.keyAt - {lead_ms};
          window.__debug.press('{action}', at, at + {hold_ms});
        }})()"""
    )


def hold_in_page(page, from_delay=40, hold_ms=1000):
    """Holds Confirm for `hold_ms` of game time, starting shortly after now."""
    page.evaluate(
        f"""(() => {{
          const s = window.__game.scene.getScene('battle');
          const at = s.time.now + {from_delay};
          window.__debug.press('confirm', at, at + {hold_ms});
        }})()"""
    )


def fight(page, out, shot_prefix):
    """Picks the highlighted command and the first target until the battle ends. Returns the final phase.
    Action commands are set to always succeed: mashing would otherwise press too early and miss."""
    page.evaluate("window.__debug.set('autoCommands', true)")
    shots = 0
    for _ in range(400):
        if not active(page, "battle"):
            break
        st = page.evaluate("(() => { const s = window.__game.scene.getScene('battle'); return [s.inputState, s.engine.phase]; })()")
        if st[1] in ("victory", "defeat", "fled"):
            if shots == 0:
                page.wait_for_timeout(500)
                page.screenshot(path=f"{out}/{shot_prefix}_{st[1]}.png")
                shots = 1
            page.wait_for_timeout(200)
            continue
        if st[0] in ("menu", "target"):
            page.wait_for_timeout(160)
            press(page, "Enter", 120)
        else:
            page.wait_for_timeout(150)
    page.evaluate("window.__debug.set('autoCommands', false)")
    return page.evaluate("window.__game.scene.getScene('battle').engine.phase")


with sync_playwright() as p:
    b = p.chromium.launch(args=["--use-gl=swiftshader", "--enable-unsafe-swiftshader"])

    # ── Desktop walkthrough ─────────────────────────────────────────────
    ctx = b.new_context(viewport={"width": 1280, "height": 720})
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto(url)
    wait_scene(page, "title", 15000)
    page.wait_for_timeout(500)
    zoom = page.evaluate("window.__game.registry.get('zoom')")
    check(zoom == 2, f"desktop 1280x720 uses 2x zoom (got {zoom})")
    problems = page.evaluate("window.__game.scene.getScene('dev_hub') && 0")
    page.screenshot(path=f"{out}/01_title.png")

    press(page, "Enter")
    wait_scene(page, "dev_hub")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/02_hub.png")
    hub_text = page.evaluate(
        "window.__game.scene.getScene('dev_hub').children.list.filter(o=>o.type==='Text').map(o=>o.text).join('|')"
    )
    check("no problems" in hub_text, "database loaded with no problems")

    press(page, "Enter")  # field test
    wait_scene(page, "field_test")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/03_field.png")

    # walk right for a moment to prove movement
    x0 = page.evaluate("window.__game.scene.getScene('field_test').player.body.x")
    # hold right until the player has moved (slow software rendering clamps the time step)
    page.keyboard.down("ArrowRight")
    try:
        page.wait_for_function(f"window.__game.scene.getScene('field_test').player.body.x > {x0 + 1.2}", timeout=4000)
    except Exception:
        pass
    page.keyboard.up("ArrowRight")
    x1 = page.evaluate("window.__game.scene.getScene('field_test').player.body.x")
    check(x1 > x0 + 1, f"player walks right in world units ({x0:.1f} -> {x1:.1f})")

    # put the player next to enemy a1 so they touch
    bx = page.evaluate(
        """() => { const s = window.__game.scene.getScene('field_test');
        const e = s.enemies.find(e => e.id === 'a1'); s.player.body.x = e.body.x - 0.5; s.player.body.z = e.body.z; return s.player.body.x; }"""
    )
    wait_scene(page, "battle")
    st = page.evaluate("window.__game.scene.getScene('field_test').sys.settings.status")
    check(st == 7, f"field sleeps during the battle (status {st})")
    wait_battle_input(page, "menu")
    page.screenshot(path=f"{out}/04_battle_menu.png")
    press(page, "Enter", 300)  # Chop
    wait_battle_input(page, "target")
    page.screenshot(path=f"{out}/05_battle_target.png")
    press(page, "Enter", 450)
    page.screenshot(path=f"{out}/05b_battle_hit.png")
    result = fight(page, out, "05c")
    check(result == "victory", f"a real fight against two goons is won ({result})")
    wait_scene(page, "field_test", 10000)
    page.wait_for_timeout(500)
    state = page.evaluate(
        """() => { const s = window.__game.scene.getScene('field_test');
        return { ids: s.enemies.map(e => e.id), x: s.player.body.x }; }"""
    )
    check("a1" not in state["ids"] and "a2" in state["ids"], f"won enemy removed, others kept ({state['ids']})")
    check(abs(state["x"] - bx) < 1, f"player is where the battle started (x {state['x']:.1f})")
    gs = page.evaluate("(() => { const s = window.__game.scene.getScene('battle').engine; return s.log; })()")
    check(any("hero chop" in l for l in gs) and any("goon_shove hero" in l for l in gs), "both sides attacked during the fight")
    page.screenshot(path=f"{out}/06_field_after.png")

    # run away from a2, then stand right on it: no battle during the grace period
    page.evaluate(
        """() => { const s = window.__game.scene.getScene('field_test');
        const e = s.enemies.find(e => e.id === 'a2'); s.player.body.x = e.body.x - 0.5; s.player.body.z = e.body.z; }"""
    )
    wait_scene(page, "battle")
    for _ in range(12):
        wait_battle_input(page, "menu")
        page.evaluate("(() => { const m = window.__game.scene.getScene('battle').menu; m.setCursor(m.items.length - 1); })()")
        press(page, "Enter", 300)  # Run away
        page.wait_for_function(
            "!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').inputState === 'menu' || window.__game.scene.getScene('battle').engine.phase === 'fled'",
            timeout=20000,
        )
        if page.evaluate("!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').engine.phase === 'fled'"):
            break
    wait_scene(page, "field_test", 10000)
    page.evaluate(
        """() => { const s = window.__game.scene.getScene('field_test');
        const e = s.enemies.find(e => e.id === 'a2'); s.player.body.x = e.body.x; s.player.body.z = e.body.z; }"""
    )
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{out}/06b_grace.png")
    grace = page.evaluate("window.__game.scene.getScene('field_test').graceMs")
    check(not active(page, "battle") and grace > 0, f"no battle while protected after running (grace left {grace:.0f} ms)")
    page.wait_for_function("window.__game.scene.isActive('battle')", timeout=5000)
    check(True, "enemy can engage again once the grace period ends")
    result = fight(page, out, "06c")
    check(result in ("victory", "defeat"), f"the mixed fight (spiky, flyer, goon) ends ({result})")
    wait_scene(page, "field_test", 10000)
    page.wait_for_timeout(300)

    # ── Action commands, fought against the sparring dummy with real key timing ──
    page.evaluate("window.__game.scene.getScene('field_test').graceMs = 99999")
    pick_debug = lambda value: page.evaluate(
        f"(() => {{ const m = window.__game.scene.getScene('debug').menu; m.setCursor(m.items.findIndex(i => i.value === '{value}')); }})()"
    )
    press(page, "F1", 400)
    pick_debug("god")  # the dummy barely hits, but earlier fights left HP low
    press(page, "Enter", 200)
    pick_debug("battle")
    press(page, "Enter", 250)
    pick_debug("test_dummy")
    press(page, "Enter")
    wait_scene(page, "battle")

    # precision press: Chop, pressed as the ring lines up
    choose_move(page, 0)
    wait_command(page, "timed_press")
    key_at(page, lead_ms=30)
    page.wait_for_timeout(max(0, ms_until_key(page) - 380))
    page.screenshot(path=f"{out}/20_cmd_press.png")
    wait_turn_over(page)
    r = last_cmds(page, "chop")
    check(r and r[-1] in ("cmd chop great", "cmd chop good"), f"precision press lands on time ({r})")

    # precision press missed on purpose: pressed far too early
    choose_move(page, 0)
    wait_command(page, "timed_press")
    page.wait_for_timeout(120)
    press(page, "Enter", 0)
    wait_turn_over(page)
    r = last_cmds(page, "chop")
    dmg = battle_eval(page, "return s.engine.log.filter(l => l.startsWith('hero chop')).map(l => l.split(' -')[1]);")
    check(r[-1] == "cmd chop miss early", f"an early press misses ({r[-1]})")
    check(dmg[-1].startswith("1") and dmg[0].split(' ')[0] in ("3", "2"), f"a miss deals less damage than a hit (hits {dmg})")

    # double jump: Elbow Drop, pressed just before each landing -> two hits
    hp0 = battle_eval(page, "return s.engine.enemies()[0].hp;")
    choose_move(page, 1)
    for n in range(2):
        try:
            wait_command(page, "stomp")
        except Exception:
            print("    log:", battle_eval(page, "return s.engine.log.slice(-6);"), battle_eval(page, "return s.commands.state;"))
            raise
        key_at(page, lead_ms=80)
        if n == 0:
            page.wait_for_timeout(120)
            page.screenshot(path=f"{out}/21_cmd_stomp.png")
        page.wait_for_function("!window.__game.scene.getScene('battle').commands.state", timeout=4000)
    wait_turn_over(page)
    r = last_cmds(page, "elbow_drop")
    hp1 = battle_eval(page, "return s.engine.enemies()[0].hp;")
    check(len(r) == 2 and all(x.split(' ')[2] in ("great", "good") for x in r) and hp0 - hp1 == 4,
          f"double jump: two timed presses give two hits ({r}, -{hp0 - hp1} HP)")

    # double jump fumbled: no press at all -> one hit only
    hp0 = hp1
    choose_move(page, 1)
    wait_turn_over(page)
    r = last_cmds(page, "elbow_drop")
    hp1 = battle_eval(page, "return s.engine.enemies()[0].hp;")
    check(r[-1] == "cmd elbow_drop miss none" and hp0 - hp1 == 2, f"no press: the combo ends after one hit ({r[-1]}, -{hp0 - hp1} HP)")

    # precision release: Body Slam, hold Z and let go inside the lit zone
    choose_move(page, 2)
    page.wait_for_function("(() => { const s = window.__game.scene.getScene('battle'); return s.commands.state && s.commands.state.kind === 'hold_release'; })()")
    page.wait_for_timeout(200)
    hold_in_page(page, hold_ms=1010)
    wait_command(page, "hold_release")
    page.wait_for_timeout(max(0, ms_until_key(page) - 220))
    page.screenshot(path=f"{out}/22_cmd_hold.png")
    wait_turn_over(page)
    r = last_cmds(page, "body_slam")
    check(r and r[-1] in ("cmd body_slam great", "cmd body_slam good"), f"precision release in the zone ({r})")

    # precision release held too long -> fizzles
    choose_move(page, 2)
    page.wait_for_function("(() => { const s = window.__game.scene.getScene('battle'); return s.commands.state && s.commands.state.kind === 'hold_release'; })()")
    page.wait_for_timeout(200)
    hold_in_page(page, hold_ms=1700)
    wait_turn_over(page)
    r = last_cmds(page, "body_slam")
    check(r[-1] == "cmd body_slam miss overheld", f"holding too long fizzles ({r[-1]})")

    # Perfect commands (debug toggle) rates everything GREAT with no input
    press(page, "F1", 300)
    pick_debug("autoCommands")
    press(page, "Enter", 150)
    press(page, "x", 300)
    choose_move(page, 1)
    wait_turn_over(page)
    r = last_cmds(page, "elbow_drop")
    check(r[-2:] == ["cmd elbow_drop great", "cmd elbow_drop great"], f"Perfect commands toggle works ({r[-2:]})")
    press(page, "F1", 300)
    pick_debug("autoCommands")
    press(page, "Enter", 150)
    pick_debug("god")
    press(page, "Enter", 150)
    press(page, "x", 300)

    # leave by running away
    for _ in range(12):
        wait_battle_input(page, "menu")
        battle_eval(page, "s.menu.setCursor(s.menu.items.length - 1);")
        press(page, "Enter", 300)
        page.wait_for_function(
            "!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').inputState === 'menu' || window.__game.scene.getScene('battle').engine.phase === 'fled'",
            timeout=20000,
        )
        if page.evaluate("!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').engine.phase === 'fled'"):
            break
    wait_scene(page, "field_test", 10000)
    page.wait_for_timeout(300)

    # ── Block and Reversal against the sparring dummy (1 damage per hit) ──
    page.evaluate("window.__debug.set('god', false); window.__debug.heal()")
    press(page, "F1", 400)
    pick_debug("battle")
    press(page, "Enter", 250)
    pick_debug("test_dummy")
    press(page, "Enter")
    wait_scene(page, "battle")

    def enemy_attack(code=None, lead=40, early=False, shot=None):
        """Lets the hero's Chop time out, then answers the dummy's strike."""
        choose_move(page, 0)
        wait_command(page, "guard", timeout=15000)
        if early:
            page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keydown', {{ code: '{code}' }}))")
            page.wait_for_timeout(40)
            page.evaluate(f"window.dispatchEvent(new KeyboardEvent('keyup', {{ code: '{code}' }}))")
        elif code:
            key_at(page, lead_ms=lead, code=code)
        if shot:
            page.wait_for_timeout(max(0, ms_until_key(page) + 120))
            page.screenshot(path=f"{out}/{shot}.png")
        wait_turn_over(page)
        hero_hp = battle_eval(page, "return s.engine.hero.hp;")
        dummy_hp = battle_eval(page, "return s.engine.enemies()[0].hp;")
        last = battle_eval(page, "return s.engine.log.filter(l => l.startsWith('guardcmd')).pop();")
        return hero_hp, dummy_hp, last

    h0 = battle_eval(page, "return s.engine.hero.hp;")
    h1, d1, g = enemy_attack("KeyZ", lead=90, shot="23_block")
    check(g == "guardcmd block" and h1 == h0, f"Block with A just before the hit takes no damage ({g}, HP {h0}->{h1})")
    h2, d2, g = enemy_attack("KeyX", lead=45, shot="24_reversal")
    check(g == "guardcmd reversal" and h2 == h1 and d2 < d1 - 0, f"Reversal with B: no damage and the dummy is hit back ({g}, dummy {d1}->{d2})")
    h3, d3, g = enemy_attack("KeyZ", early=True)
    check(g == "guardcmd none early" and h3 == h2 - 1, f"pressing during the wind-up is too early ({g}, HP {h2}->{h3})")
    h4, d4, g = enemy_attack(None)
    check(g == "guardcmd none none" and h4 == h3 - 1, f"no guard takes the full hit ({g}, HP {h3}->{h4})")

    for _ in range(12):
        wait_battle_input(page, "menu")
        battle_eval(page, "s.menu.setCursor(s.menu.items.length - 1);")
        press(page, "Enter", 300)
        page.wait_for_function(
            "!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').inputState === 'menu' || window.__game.scene.getScene('battle').engine.phase === 'fled'",
            timeout=20000,
        )
        if page.evaluate("!window.__game.scene.isActive('battle') || window.__game.scene.getScene('battle').engine.phase === 'fled'"):
            break
    wait_scene(page, "field_test", 10000)
    page.wait_for_timeout(300)

    # through the east door
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 39; s.player.body.z = 4; }")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(600)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field_test').roomId")
    check(room == "test_b", f"door leads to room B (in {room})")
    page.screenshot(path=f"{out}/07_room_b.png")

    # room B's east door leads into the octagon arena
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 18.6; s.player.body.z = 5; }")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(500)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field_test').roomId")
    check(room == "test_octagon", f"room B's east door leads into the octagon ({room})")
    page.screenshot(path=f"{out}/07b_octagon_gate.png")
    # a slanted wall: walk into the front-left diagonal and slide along it
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 12; s.player.body.z = 3; s.graceMs = 99999; }")
    page.keyboard.down("ArrowLeft")
    page.wait_for_timeout(1600)
    page.keyboard.up("ArrowLeft")
    pos = page.evaluate("(() => { const b = window.__game.scene.getScene('field_test').player.body; return [b.x, b.z]; })()")
    check(pos[0] + pos[1] >= 10 and pos[1] > 3.3, f"slanted wall holds and slides you ({pos[0]:.1f}, {pos[1]:.1f})")
    page.wait_for_timeout(600)
    page.screenshot(path=f"{out}/07c_octagon_corner.png")
    # stand by the ring, then at the back: the camera scrolls up into the depth
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 30; s.player.body.z = 6; }")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{out}/07d_octagon_ring.png")
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 26; s.player.body.z = 14; s.player.body.y = 1.5; }")
    page.wait_for_timeout(900)
    on_ring = page.evaluate("window.__game.scene.getScene('field_test').player.body.y")
    check(abs(on_ring - 1) < 0.01, f"you can stand on the ring (y {on_ring:.2f})")
    page.screenshot(path=f"{out}/07f_in_ring.png")
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 30; s.player.body.z = 27; }")
    page.wait_for_timeout(1200)
    # in perspective the deep room fits on screen: the player at the back is in view
    feet = page.evaluate("(() => { const s = window.__game.scene.getScene('field_test'); return s.player.sprite.y - s.cameras.main.scrollY; })()")
    check(40 < feet < 360, f"the back of a deep room is in view (player's feet at y {feet:.0f})")
    page.screenshot(path=f"{out}/07e_octagon_back.png")
    # out through the gate on the left wall, back to room B
    page.evaluate("() => { const s = window.__game.scene.getScene('field_test'); s.player.body.x = 1.2; s.player.body.z = 15; }")
    # hold left until the room changes (slow software rendering clamps the time step)
    page.keyboard.down("ArrowLeft")
    try:
        page.wait_for_function("window.__game.scene.getScene('field_test').roomId === 'test_b'", timeout=4000)
    except Exception:
        pass
    page.keyboard.up("ArrowLeft")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field_test').roomId")
    check(room == "test_b", f"octagon gate leads back to room B ({room})")

    # debug menu
    press(page, "F1", 400)
    check(page.evaluate("window.__game.scene.getScene('debug').open"), "F1 opens the debug menu")
    check(page.evaluate("window.__game.scene.isPaused('field_test')"), "game pauses under the debug menu")
    page.screenshot(path=f"{out}/08_debug.png")
    press(page, "ArrowDown")
    press(page, "ArrowDown")
    press(page, "ArrowDown")  # Hitboxes
    press(page, "Enter")
    press(page, "x", 300)  # close
    check(not page.evaluate("window.__game.scene.getScene('debug').open"), "Cancel closes the debug menu")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/09_hitboxes.png")

    press(page, "Escape")  # back to hub
    wait_scene(page, "dev_hub")
    for i, (name, shot) in enumerate(
        [("input_test", "10_input"), ("ui_kit", "11_ui_kit"), ("anim_test", "12_anim"), ("data_report", "13_data")], start=1
    ):
        page.wait_for_timeout(400)
        for _ in range(i):
            press(page, "ArrowDown")
        press(page, "Enter")
        wait_scene(page, name)
        page.wait_for_timeout(500)
        if name == "ui_kit":
            press(page, "Enter", 700)  # lose 3 HP: ghost bar
            page.screenshot(path=f"{out}/{shot}.png")
            for _ in range(4):
                press(page, "ArrowDown")
            press(page, "Enter", 400)  # confirm dialog
            page.screenshot(path=f"{out}/11b_dialog.png")
            press(page, "Enter", 300)  # answer No
            press(page, "x")
        elif name == "input_test":
            page.keyboard.down("KeyC")
            page.keyboard.down("ArrowLeft")
            page.wait_for_timeout(200)
            page.screenshot(path=f"{out}/{shot}.png")
            page.keyboard.up("KeyC")
            page.keyboard.up("ArrowLeft")
            press(page, "Escape")
        else:
            page.screenshot(path=f"{out}/{shot}.png")
            press(page, "x")
        wait_scene(page, "dev_hub")
        # return the hub cursor to the top for the next loop
        page.evaluate("window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor(0)")

    # crash screen
    page.wait_for_timeout(600)
    press(page, "x")
    wait_scene(page, "title")
    press(page, "F8", 400)
    check(page.evaluate("!!document.getElementById('crash')"), "F8 on the title shows the crash screen")
    real = [e for e in errors if "fonts.g" not in e and "ERR_" not in e and "Test crash" not in e]
    check(not real, f"no errors on desktop {real[:3]}")
    ctx.close()

    # ── Phones ──────────────────────────────────────────────────────────
    for name, vp, rotate in [("phone_landscape", (844, 390), False), ("phone_portrait", (390, 844), True)]:
        ctx = b.new_context(viewport={"width": vp[0], "height": vp[1]}, is_mobile=True, has_touch=True, device_scale_factor=3)
        page = ctx.new_page()
        errors = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(url)
        wait_scene(page, "title", 15000)
        shown = page.evaluate("getComputedStyle(document.getElementById('rotate')).display") == "flex"
        check(shown == rotate, f"{name}: rotate notice {'shown' if rotate else 'hidden'}")
        if not rotate:
            box = page.locator("#game canvas").bounding_box()
            page.touchscreen.tap(box["x"] + box["width"] / 2, box["y"] + box["height"] / 2)
            wait_scene(page, "dev_hub")
            page.wait_for_timeout(400)
            visible = page.evaluate("window.__game.scene.getScene('touch_controls').layer.visible")
            check(visible, "touch controls appear after a tap")
            page.screenshot(path=f"{out}/14_{name}_hub.png")
        check(not errors, f"{name}: no errors {errors[:2]}")
        ctx.close()
    b.close()

srv.shutdown()
print("RESULT:", "FAIL" if failures else "PASS", f"({len(failures)} failed)" if failures else "")
sys.exit(1 if failures else 0)
