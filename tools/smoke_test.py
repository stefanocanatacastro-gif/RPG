"""Headless browser test of the built game (dist/index.html).

Walks the whole foundations loop the way a player would: title -> dev hub ->
grey-box room -> touch an enemy -> battle -> win -> back in the room with the
enemy gone and coins added -> through the door -> debug menu -> every test
screen, the sandbox and the crash screen. Screenshots go to the folder given
as the first argument.
"""
import sys, threading, http.server, functools, os, json
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
        if st[0] == "scout":
            press(page, "Enter", 300)
            continue
        if st[0] == "results":
            page.wait_for_timeout(900)  # let the XP bar fill
            page.screenshot(path=f"{out}/{shot_prefix}_results.png")
            press(page, "Enter", 300)
            continue
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

    # Start opens the title menu; with no saves it offers New game and Dev hub
    press(page, "Enter", 400)
    page.wait_for_function("!!window.__game.scene.getScene('title').menu", timeout=5000)
    labels = page.evaluate("window.__game.scene.getScene('title').menu.items.map(i => i.value)")
    check(labels == ["new", "dev"], f"a first visit offers New game and Dev hub ({labels})")
    page.screenshot(path=f"{out}/01b_title_menu.png")
    page.evaluate("window.__game.scene.getScene('title').menu.setCursor(1)")
    press(page, "Enter")
    wait_scene(page, "dev_hub")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/02_hub.png")
    hub_text = page.evaluate(
        "window.__game.scene.getScene('dev_hub').children.list.filter(o=>o.type==='Text').map(o=>o.text).join('|')"
    )
    check("no problems" in hub_text, "database loaded with no problems")

    press(page, "Enter")  # field test
    wait_scene(page, "field")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/03_field.png")

    # walk right for a moment to prove movement
    x0 = page.evaluate("window.__game.scene.getScene('field').player.body.x")
    # hold right until the player has moved (slow software rendering clamps the time step)
    page.keyboard.down("ArrowRight")
    try:
        page.wait_for_function(f"window.__game.scene.getScene('field').player.body.x > {x0 + 1.2}", timeout=4000)
    except Exception:
        pass
    page.keyboard.up("ArrowRight")
    x1 = page.evaluate("window.__game.scene.getScene('field').player.body.x")
    check(x1 > x0 + 1, f"player walks right in world units ({x0:.1f} -> {x1:.1f})")

    # put the player next to enemy a1 so they touch
    bx = page.evaluate(
        """() => { const s = window.__game.scene.getScene('field');
        const e = s.enemies.find(e => e.id === 'a1'); s.player.body.x = e.body.x - 0.5; s.player.body.z = e.body.z; return s.player.body.x; }"""
    )
    wait_scene(page, "battle")
    st = page.evaluate("window.__game.scene.getScene('field').sys.settings.status")
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
    wait_scene(page, "field", 10000)
    page.wait_for_timeout(500)
    state = page.evaluate(
        """() => { const s = window.__game.scene.getScene('field');
        return { ids: s.enemies.map(e => e.id), x: s.player.body.x }; }"""
    )
    check("a1" not in state["ids"] and "a2" in state["ids"], f"won enemy removed, others kept ({state['ids']})")
    check(abs(state["x"] - bx) < 1, f"player is where the battle started (x {state['x']:.1f})")
    gs = page.evaluate("(() => { const s = window.__game.scene.getScene('battle').engine; return s.log; })()")
    check(any("hero chop" in l for l in gs) and any("goon_shove hero" in l for l in gs), "both sides attacked during the fight")
    page.screenshot(path=f"{out}/06_field_after.png")

    # run away from a2, then stand right on it: no battle during the grace period
    page.evaluate(
        """() => { const s = window.__game.scene.getScene('field');
        const e = s.enemies.find(e => e.id === 'a2'); s.player.body.x = e.body.x - 0.5; s.player.body.z = e.body.z; }"""
    )
    page.evaluate("window.__debug.set('god', true)")  # this checks running away; losing is tested later
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
    wait_scene(page, "field", 10000)
    page.evaluate("window.__debug.set('god', false)")
    page.evaluate(
        """() => { const s = window.__game.scene.getScene('field');
        const e = s.enemies.find(e => e.id === 'a2'); s.player.body.x = e.body.x; s.player.body.z = e.body.z; }"""
    )
    page.wait_for_timeout(1500)
    page.screenshot(path=f"{out}/06b_grace.png")
    grace = page.evaluate("window.__game.scene.getScene('field').graceMs")
    check(not active(page, "battle") and grace > 0, f"no battle while protected after running (grace left {grace:.0f} ms)")
    page.wait_for_function("window.__game.scene.isActive('battle')", timeout=5000)
    check(True, "enemy can engage again once the grace period ends")
    # god mode: this checks the fight plays out to the end (losing now means Game Over, tested later)
    page.evaluate("window.__debug.set('god', true)")
    result = fight(page, out, "06c")
    page.evaluate("window.__debug.set('god', false)")
    check(result == "victory", f"the mixed fight (spiky, flyer, goon) ends ({result})")
    wait_scene(page, "field", 10000)
    page.wait_for_timeout(300)

    # ── Action commands, fought against the sparring dummy with real key timing ──
    page.evaluate("window.__game.scene.getScene('field').graceMs = 99999")
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
    wait_scene(page, "field", 10000)
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
    h2, d2, g = enemy_attack("KeyX", lead=56, shot="24_reversal")
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
    wait_scene(page, "field", 10000)
    page.wait_for_timeout(300)

    # ── Enemy patterns: the Bruiser winds up and lets go, a GREAT hit staggers him, the Medic heals ──
    page.evaluate("window.__debug.set('god', true); window.__debug.set('autoCommands', true); window.__debug.heal()")
    press(page, "F1", 400)
    pick_debug("battle")
    press(page, "Enter", 250)
    pick_debug("test_crew")
    press(page, "Enter")
    wait_scene(page, "battle")

    def defend():
        wait_battle_input(page, "menu", 30000)
        battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'defend'));")
        press(page, "Enter", 200)

    def crew_log():
        return battle_eval(page, "return s.engine.log.slice();")

    defend()  # round 1: the Bruiser starts winding up
    page.wait_for_function(
        "window.__game.scene.getScene('battle').engine.log.some(l => l === 'charge e0 running_lariat')", timeout=20000
    )
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/25_charge.png")
    defend()  # round 2: he lets it go
    page.wait_for_function(
        "window.__game.scene.getScene('battle').engine.log.some(l => l === 'release e0 running_lariat')", timeout=20000
    )
    page.wait_for_timeout(300)
    page.screenshot(path=f"{out}/26_release.png")
    defend()  # round 3: winding up again
    wait_battle_input(page, "menu", 30000)
    charging = battle_eval(page, "return !!s.engine.get('e0').charging;")
    check(charging, "the Bruiser charges every other round")
    choose_move(page, 0)  # Chop him while he's charging (Perfect commands: GREAT)
    page.wait_for_function(
        "window.__game.scene.getScene('battle').engine.log.some(l => l === 'break e0')", timeout=20000
    )
    page.wait_for_timeout(250)
    page.screenshot(path=f"{out}/27_stagger.png")
    wait_battle_input(page, "menu", 30000)
    log = crew_log()
    check(any(l.startswith("heal e0") for l in log), f"the Medic patches up the hurt Bruiser ({[l for l in log if l.startswith(('heal', 'support'))]})")
    check(not any(l.startswith("release e0") for l in log[log.index("break e0"):]), "a staggered Bruiser never releases that charge")
    # take the Medic out first: Elbow Drop reaches the back row
    for _ in range(4):
        if battle_eval(page, "return s.engine.get('e2').hp <= 0;"):
            break
        wait_battle_input(page, "menu", 30000)
        battle_eval(page, "s.menu.setCursor(1);")
        press(page, "Enter", 200)
        wait_battle_input(page, "target")
        press(page, "ArrowLeft", 120)
        press(page, "Enter", 50)
        page.wait_for_function(
            "(() => { const s = window.__game.scene.getScene('battle'); return s.inputState === 'menu' || s.engine.phase === 'victory'; })()",
            timeout=30000,
        )
    check(battle_eval(page, "return s.engine.get('e2').hp <= 0;"), "Elbow Drop reaches the Medic in the back row")
    phase = fight(page, out, "28_crew")
    check(phase == "victory", f"the crew is beaten ({phase})")
    check(os.path.exists(f"{out}/28_crew_results.png"), "the results screen waits for a button press")
    page.evaluate("window.__debug.set('god', false); window.__debug.set('autoCommands', false)")
    wait_scene(page, "field", 10000)
    page.wait_for_timeout(300)

    fs = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('field'); {js} }})()")

    def close_messages(limit=12):
        for _ in range(limit):
            if not fs("return s.msg.open;"):
                return
            press(page, "Enter", 250)

    def flags():
        return json.loads(page.evaluate("window.__debug.save()"))["flags"]

    # a story trigger near room A's east door fires once
    fs("s.graceMs = 99999; s.player.body.x = 32.5; s.player.body.z = 4;")
    page.keyboard.down("ArrowRight")
    try:
        page.wait_for_function("window.__game.scene.getScene('field').msg.open", timeout=4000)
    except Exception:
        pass
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(500)
    check(fs("return s.msg.open;") and flags().get("test_a_trigger") is True, "walking into a story trigger shows its text and sets its flag")
    page.screenshot(path=f"{out}/06d_trigger.png")
    close_messages()
    fs("s.player.body.x = 33; s.player.body.z = 4;")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(500)
    page.keyboard.up("ArrowRight")
    check(not fs("return s.msg.open;"), "a once-only trigger stays quiet the second time")

    # through the east door
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 39; s.player.body.z = 4; }")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(600)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field').roomId")
    check(room == "test_b", f"door leads to room B (in {room})")
    page.screenshot(path=f"{out}/07_room_b.png")

    # room B: the Octagon gate is locked until the kid lets you in
    fs("s.graceMs = 99999; s.player.body.x = 18.6; s.player.body.z = 5;")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(500)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(500)
    check(fs("return s.roomId;") == "test_b" and fs("return s.msg.open;"), "a locked gate keeps you in and says why")
    page.screenshot(path=f"{out}/07a_locked.png")
    close_messages()
    # talk to the kid: face him and press Z (jump becomes talk next to someone)
    fs("s.player.body.x = 2.7; s.player.body.z = 6.5;")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(60)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(300)
    check(fs("return s.marker.visible;"), "a ! appears next to someone you can talk to")
    press(page, "KeyZ", 600)
    check(fs("return s.msg.open;"), "Z talks instead of jumping")
    page.screenshot(path=f"{out}/07e_talk.png")
    close_messages()
    check(flags().get("test_gate_open") is True, "talking to the kid opens the gate (sets its flag)")
    after = fs("return s.objects.filter(o => o.visible).map(o => o.def.id);")
    check("kid_after" in after and "kid_before" not in after, f"the kid's lines change with the flag ({after})")
    # the chest gives its item once
    items0 = len(json.loads(page.evaluate("window.__debug.save()"))["items"])
    fs("s.player.body.x = 10; s.player.body.z = 9.3; s.player.body.y = 0;")
    page.wait_for_timeout(300)
    press(page, "KeyZ", 500)
    close_messages()
    items1 = len(json.loads(page.evaluate("window.__debug.save()"))["items"])
    check(items1 == items0 + 1 and flags().get("test_chest_b") is True, f"the chest gives a Water Bottle ({items0} -> {items1} items)")
    press(page, "KeyZ", 500)
    close_messages()
    items2 = len(json.loads(page.evaluate("window.__debug.save()"))["items"])
    check(items2 == items1, "an opened chest is empty")
    saves = lambda: page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.saves') || '{}')")
    check("auto" in saves(), "entering a room autosaves")
    # the save block: pick slot 1
    fs("s.player.body.x = 17; s.player.body.z = 8.8; s.player.body.y = 0;")
    page.wait_for_timeout(300)
    press(page, "KeyZ", 700)
    page.screenshot(path=f"{out}/07f_save_slots.png")
    press(page, "Enter", 600)
    close_messages()
    sv = saves()
    check("1" in sv and sv["1"]["meta"]["room"] == "test_b", f"the save block saves to slot 1 ({list(sv)})")

    # room B's east door leads into the octagon arena
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 18.6; s.player.body.z = 5; }")
    page.keyboard.down("ArrowRight")
    page.wait_for_timeout(500)
    page.keyboard.up("ArrowRight")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field').roomId")
    check(room == "test_octagon", f"room B's east door leads into the octagon ({room})")
    page.screenshot(path=f"{out}/07b_octagon_gate.png")
    # a slanted wall: walk into the front-left diagonal and slide along it
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 12; s.player.body.z = 3; s.graceMs = 99999; }")
    page.keyboard.down("ArrowLeft")
    page.wait_for_timeout(1600)
    page.keyboard.up("ArrowLeft")
    pos = page.evaluate("(() => { const b = window.__game.scene.getScene('field').player.body; return [b.x, b.z]; })()")
    check(pos[0] + pos[1] >= 10 and pos[1] > 3.3, f"slanted wall holds and slides you ({pos[0]:.1f}, {pos[1]:.1f})")
    page.wait_for_timeout(600)
    page.screenshot(path=f"{out}/07c_octagon_corner.png")
    # stand by the ring, then at the back: the camera scrolls up into the depth
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 30; s.player.body.z = 6; }")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{out}/07d_octagon_ring.png")
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 26; s.player.body.z = 14; s.player.body.y = 1.5; }")
    page.wait_for_timeout(900)
    on_ring = page.evaluate("window.__game.scene.getScene('field').player.body.y")
    check(abs(on_ring - 1) < 0.01, f"you can stand on the ring (y {on_ring:.2f})")
    page.screenshot(path=f"{out}/07f_in_ring.png")
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 30; s.player.body.z = 27; }")
    page.wait_for_timeout(1200)
    # in perspective the deep room fits on screen: the player at the back is in view
    feet = page.evaluate("(() => { const s = window.__game.scene.getScene('field'); return s.player.sprite.y - s.cameras.main.scrollY; })()")
    check(40 < feet < 360, f"the back of a deep room is in view (player's feet at y {feet:.0f})")
    page.screenshot(path=f"{out}/07e_octagon_back.png")
    # out through the gate on the left wall, back to room B
    page.evaluate("() => { const s = window.__game.scene.getScene('field'); s.player.body.x = 1.2; s.player.body.z = 15; }")
    # hold left until the room changes (slow software rendering clamps the time step)
    page.keyboard.down("ArrowLeft")
    try:
        page.wait_for_function("window.__game.scene.getScene('field').roomId === 'test_b'", timeout=4000)
    except Exception:
        pass
    page.keyboard.up("ArrowLeft")
    page.wait_for_timeout(900)
    room = page.evaluate("window.__game.scene.getScene('field').roomId")
    check(room == "test_b", f"octagon gate leads back to room B ({room})")

    # debug menu
    press(page, "F1", 400)
    check(page.evaluate("window.__game.scene.getScene('debug').open"), "F1 opens the debug menu")
    check(page.evaluate("window.__game.scene.isPaused('field')"), "game pauses under the debug menu")
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

    # ── Battle sandbox ──
    page.wait_for_timeout(400)
    press(page, "ArrowDown")
    press(page, "Enter")
    wait_scene(page, "battle_sandbox")
    page.wait_for_timeout(400)
    page.screenshot(path=f"{out}/15_sandbox.png")
    sb = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('battle_sandbox'); {js} }})()")
    press(page, "ArrowDown")  # Enemy 1
    press(page, "ArrowRight")
    page.screenshot(path=f"{out}/15b_sandbox_enemy.png")
    press(page, "ArrowLeft")
    sb("s.pressRow('Simulate', 'confirm');")
    page.wait_for_timeout(300)
    sim = sb("return s.lastSim;")
    check(sim and sim["runs"] == 200 and sim["wins"] + sim["losses"] + sim["timeouts"] == 200, f"the sandbox simulates 200 fights ({sim and sim['wins']} wins)")
    page.screenshot(path=f"{out}/16_sandbox_sim.png")
    # play two goons on the dock stage with a big HP pool, Perfect commands and god mode
    sb("s.s.preset = 0; s.pressRow('Line-up', 'confirm');")
    sb("s.pressRow('Stage', 'right'); s.pressRow('Max HP', 'right'); s.pressRow('Assist', 'left');")
    stage = sb("return s.rows.find(r => r.label === 'Stage').value();")
    gs_before = page.evaluate("window.__debug.save()")
    flags_before = page.evaluate("[window.__debug.state.god, window.__debug.state.autoCommands]")
    sb("s.pressRow('FIGHT', 'confirm');")
    wait_scene(page, "battle")
    wait_battle_input(page, "menu")
    page.screenshot(path=f"{out}/17_sandbox_battle_{stage.replace(' ', '_')}.png")
    hp = battle_eval(page, "return [s.engine.hero.hp, s.engine.hero.maxHp];")
    check(hp == [11, 11], f"the fight uses the sandbox's HP ({hp})")
    pip = battle_eval(page, "return s.engine.partner ? s.engine.partner.defId : null;")
    check(pip == "pip", f"Pip fights alongside Chispa in the sandbox ({pip})")
    phase = fight(page, out, "18_sandbox")
    acted = page.evaluate("window.__game.scene.getScene('battle').engine.log.filter(l => l.startsWith('partner ')).length")
    check(acted > 0, f"Pip takes his own turns ({acted} actions)")
    check(phase == "victory", f"the sandbox fight is won ({phase})")
    wait_scene(page, "battle_sandbox", 10000)
    page.wait_for_timeout(300)
    page.screenshot(path=f"{out}/19_sandbox_report.png")
    last = sb("return s.lastFight;")
    check(last and last["result"] == "win", f"the sandbox reports the fight ({last})")
    gs_after = page.evaluate("window.__debug.save()")
    check(gs_before == gs_after, "a sandbox fight leaves the save untouched")
    flags = page.evaluate("[window.__debug.state.god, window.__debug.state.autoCommands]")
    check(flags == flags_before, f"the sandbox puts the debug switches back ({flags_before} -> {flags})")
    press(page, "x", 300)
    wait_scene(page, "dev_hub")
    page.evaluate("window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor(0)")

    # ── Room editor ──
    page.wait_for_timeout(400)
    press(page, "ArrowDown")
    press(page, "ArrowDown")
    press(page, "Enter")
    wait_scene(page, "room_editor")
    page.wait_for_timeout(400)
    ed = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('room_editor'); {js} }})()")
    ed("s.switchRoom('test_b');")
    page.screenshot(path=f"{out}/20_editor.png")
    nb = ed("return s.room.blocks.length;")
    # place a block by clicking with the block tool
    box = page.locator("#game canvas").bounding_box()
    k = box["width"] / 640
    ed("s.tool = 'block'; s.refresh(false);")
    # click the middle of the plan
    page.mouse.click(box["x"] + 227 * k, box["y"] + 180 * k)
    page.wait_for_timeout(300)
    check(ed("return s.room.blocks.length;") == nb + 1, "the block tool places a block where you click")
    page.keyboard.press("Control+z")
    page.wait_for_timeout(200)
    check(ed("return s.room.blocks.length;") == nb, "Ctrl+Z undoes it")
    ed("s.place('npc', 6, 2);")
    obj = ed("return s.room.objects[s.room.objects.length - 1];")
    check(obj["kind"] == "npc" and ed("return s.problems.length;") == 0, f"a new person is valid room data ({obj['id']})")
    page.screenshot(path=f"{out}/21_editor_npc.png")
    ed("s.play();")
    wait_scene(page, "field", 10000)
    page.wait_for_timeout(600)
    ids = page.evaluate("window.__game.scene.getScene('field').objects.map(o => o.def.id)")
    check(obj["id"] in ids, f"PLAY walks into the edited room ({obj['id']} is there)")
    page.screenshot(path=f"{out}/22_editor_play.png")
    press(page, "F2", 300)
    wait_scene(page, "room_editor", 10000)
    page.keyboard.press("Control+s")
    page.wait_for_timeout(400)
    saved = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.rooms') || '{}')")
    check("test_b" in saved and any(o["id"] == obj["id"] for o in saved["test_b"].get("objects", [])), "Ctrl+S saves the room")
    ed("s.revert();")
    page.wait_for_timeout(300)
    check(not any(o["id"] == obj["id"] for o in ed("return s.room.objects;")), "REVERT puts the room back as it ships")
    ed("s.leave();")
    wait_scene(page, "dev_hub")
    page.evaluate("window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor(0)")

    # ── Fighter maker ──
    page.wait_for_timeout(400)
    for _ in range(3):
        press(page, "ArrowDown")
    press(page, "Enter")
    wait_scene(page, "fighter_maker")
    page.wait_for_timeout(400)
    fm = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('fighter_maker'); {js} }})()")
    fm("s.addFighter('hero'); s.mine[s.mine.length - 1].name = 'Test Hero'; s.mine[s.mine.length - 1].hp = 30; s.refresh();")
    fm("s.addFighter('enemy'); s.mine[s.mine.length - 1].name = 'Test Rival'; s.refresh();")
    page.screenshot(path=f"{out}/25_maker.png")
    check(fm("return s.problems.length;") == 0, "a new hero and enemy are valid fighters")
    fm("s.save();")
    page.wait_for_timeout(400)
    built = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.builds') || '{}')")
    check(len(built.get("fighters", [])) == 2, f"SAVE keeps both fighters ({len(built.get('fighters', []))})")
    fm("s.tryIt();")
    wait_scene(page, "battle_sandbox", 10000)
    enemy0 = page.evaluate("window.__game.scene.getScene('battle_sandbox').s.enemies[0].id")
    check(enemy0 == "c.me.f2", f"TRY puts the made enemy in the sandbox ({enemy0})")
    page.evaluate("(() => { const s = window.__game.scene.getScene('battle_sandbox'); s.useHero('c.me.f1'); s.s.assist = 3; s.pressRow('FIGHT', 'confirm'); })()")
    wait_scene(page, "battle", 10000)
    wait_battle_input(page, "menu")
    lead = battle_eval(page, "return [s.engine.hero.defId, s.engine.hero.maxHp, s.engine.enemies()[0].defId];")
    check(lead == ["c.me.f1", 30, "c.me.f2"], f"the made hero leads the fight against the made enemy ({lead})")
    page.screenshot(path=f"{out}/26_maker_battle.png")
    phase = fight(page, out, "27_maker")
    check(phase == "victory", f"the made fighters fight it out ({phase})")
    wait_scene(page, "battle_sandbox", 10000)
    page.evaluate("window.__game.scene.getScene('battle_sandbox').leave()")
    wait_scene(page, "dev_hub")
    page.evaluate("window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor(0)")

    for i, (name, shot) in enumerate(
        [("input_test", "10_input"), ("ui_kit", "11_ui_kit"), ("anim_test", "12_anim"), ("data_report", "13_data")], start=4
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

    # Continue: reload, and the newest save puts you back where it was made
    page.reload()
    wait_scene(page, "title", 15000)
    page.wait_for_timeout(600)
    press(page, "Enter", 400)
    page.wait_for_function("!!window.__game.scene.getScene('title').menu", timeout=5000)
    labels = page.evaluate("window.__game.scene.getScene('title').menu.items.map(i => i.value)")
    check(labels[0] == "continue" and "load" in labels, f"with saves, the title offers Continue first ({labels})")
    newest = page.evaluate("(() => { const s = JSON.parse(localStorage.getItem('kid-chispa.saves')); return Object.values(s).sort((a, b) => a.meta.savedAt < b.meta.savedAt ? 1 : -1)[0].meta.room; })()")
    press(page, "Enter")
    wait_scene(page, "field", 10000)
    room = page.evaluate("window.__game.scene.getScene('field').roomId")
    check(room == newest, f"Continue loads the newest save ({room})")
    page.screenshot(path=f"{out}/23_continue.png")

    # losing for real: Smelling Salts first, then Game Over, then Continue
    page.evaluate("window.__debug.set('god', false); window.__debug.set('autoCommands', false); window.__debug.setHp(1); window.__debug.give('smelling_salts')")
    page.evaluate("window.__game.scene.getScene('field').graceMs = 99999")
    page.wait_for_timeout(1000)  # let the curtain finish opening
    press(page, "F1", 600)
    pick_debug("battle")
    press(page, "Enter", 250)
    pick_debug("test_goons")
    press(page, "Enter")
    wait_scene(page, "battle")
    revived = False
    for _ in range(80):
        if page.evaluate("window.__game.scene.isActive('game_over')"):
            break
        if not active(page, "battle"):
            page.wait_for_timeout(300)
            continue
        st = page.evaluate("(() => { const s = window.__game.scene.getScene('battle'); return [s.inputState, s.engine.log.some(l => l.startsWith('revive hero smelling_salts'))]; })()")
        revived = revived or st[1]
        if st[0] == "menu":
            battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'defend'));")
            press(page, "Enter", 300)
        else:
            page.wait_for_timeout(300)
    check(revived, "Smelling Salts get Chispa back up when he's knocked out")
    wait_scene(page, "game_over", 15000)
    page.wait_for_function("!!window.__game.scene.getScene('game_over').menu", timeout=5000)
    page.screenshot(path=f"{out}/24_game_over.png")
    check(not active(page, "field"), "Game Over closes the room the fight started in")
    press(page, "Enter")
    wait_scene(page, "field", 10000)
    hp = json.loads(page.evaluate("window.__debug.save()"))["party"][0]["hp"]
    check(page.evaluate("window.__game.scene.getScene('field').roomId") == newest and hp > 1, f"Continue after Game Over loads the last save ({hp} HP)")
    real = [e for e in errors if "fonts.g" not in e and "ERR_" not in e and "Test crash" not in e]
    check(not real, f"no errors on desktop {real[:3]}")
    ctx.close()

    b.close()

srv.shutdown()
print("RESULT:", "FAIL" if failures else "PASS", f"({len(failures)} failed)" if failures else "")
sys.exit(1 if failures else 0)
