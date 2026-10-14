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
    try:
        page.wait_for_function(f"window.__game && window.__game.scene.isActive('{key}')", timeout=timeout)
    except Exception:
        scenes = page.evaluate("window.__game.scene.getScenes(true).map(s => s.sys.settings.key)")
        page.screenshot(path=f"{out}/zz_stuck_waiting_{key}.png")
        print(f"  STUCK waiting for {key}; active: {scenes}; errors: {ERRORS[-3:]}")
        raise
    page.wait_for_timeout(250)


ERRORS = []


def hub_open(page, index):
    """Opens a dev hub entry once the hub has finished fading in."""
    wait_scene(page, "dev_hub")
    page.wait_for_timeout(600)
    page.evaluate(f"window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor({index})")
    press(page, "Enter")


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
    ctx = b.new_context(viewport={"width": 1920, "height": 1080})
    page = ctx.new_page()
    errors = ERRORS
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: m.type == "error" and errors.append(m.text))
    page.goto(url)
    wait_scene(page, "title", 15000)
    page.wait_for_timeout(500)
    zoom = page.evaluate("window.__game.registry.get('zoom')")
    check(zoom == 2, f"desktop 1920x1080 uses 2x zoom (got {zoom})")
    problems = page.evaluate("window.__game.scene.getScene('dev_hub') && 0")
    page.screenshot(path=f"{out}/01_title.png")

    # Start lights up the two doors: PLAY and MAKE
    press(page, "Enter", 600)
    page.wait_for_function("!!window.__game.scene.getScene('title').doors", timeout=5000)
    doors = page.evaluate("window.__game.scene.getScene('title').doors.map(d => d.value)")
    check(doors == ["play", "make"], f"the title offers two doors, PLAY and MAKE ({doors})")
    page.screenshot(path=f"{out}/01b_title_doors.png")
    press(page, "Enter")  # PLAY is lit first
    wait_scene(page, "play")
    page.wait_for_timeout(600)
    pl = lambda js: page.evaluate("(() => { const s = window.__game.scene.getScene('play'); " + js + " })()")
    shelf = pl("return s.entries().map(e => e.key);")
    check(len(shelf) == 7 and shelf[0] == "show:dock_rumble", f"PLAY opens on the 7 showcase fights ({len(shelf)})")
    page.screenshot(path=f"{out}/02_play.png")
    press(page, "Enter", 300)  # the focused card's details
    check(pl("return s.open && s.open.key;") == "show:dock_rumble", "Enter opens the focused fight's details")
    page.screenshot(path=f"{out}/02b_details.png")
    press(page, "Enter")  # FIGHT!
    wait_scene(page, "battle")
    st = page.evaluate("window.__game.scene.getScene('play').sys.settings.status")
    check(st == 7, f"the Battle World sleeps during the fight (status {st})")
    wait_battle_input(page, "menu")
    page.screenshot(path=f"{out}/04_battle_menu.png")
    press(page, "Enter", 300)  # Chop
    wait_battle_input(page, "target")
    page.screenshot(path=f"{out}/05_battle_target.png")
    press(page, "Enter", 450)
    page.screenshot(path=f"{out}/05b_battle_hit.png")
    result = fight(page, out, "05c")
    check(result == "victory", f"a real fight against three goons is won ({result})")
    gs = page.evaluate("(() => { const s = window.__game.scene.getScene('battle').engine; return s.log; })()")
    check(any("hero chop" in l for l in gs) and any("goon_shove hero" in l for l in gs), "both sides attacked during the fight")
    wait_scene(page, "play", 10000)
    page.wait_for_function("!!window.__game.scene.getScene('play').result", timeout=8000)
    res = pl("return s.result;")
    check(res and res["result"] == "win", f"after the bell the Battle World shows how it went ({res})")
    page.wait_for_timeout(600)
    rec = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.plays') || '{}')['show:dock_rumble']")
    check(rec and rec["plays"] == 1 and rec["wins"] == 1, f"the win is recorded ({rec})")
    page.screenshot(path=f"{out}/06_result.png")
    pl("s.like(s.open); return 0;")
    page.wait_for_timeout(300)
    liked = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.likes') || '[]')")
    check("encounter:show:dock_rumble" in liked, f"LIKE IT likes the fight ({liked})")
    # Escape closes the panel, then goes back to the title; the backtick opens the builder's hub
    press(page, "Escape", 400)
    press(page, "Escape")
    wait_scene(page, "title")
    page.wait_for_timeout(700)
    press(page, "Backquote")
    wait_scene(page, "dev_hub")
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/02_hub.png")
    hub_text = page.evaluate(
        "window.__game.scene.getScene('dev_hub').children.list.filter(o=>o.type==='Text').map(o=>o.text).join('|')"
    )
    check("no problems" in hub_text, "database loaded with no problems")

    # ── Action commands, fought against the sparring dummy with real key timing ──
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
    wait_scene(page, "dev_hub", 10000)
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
    wait_scene(page, "dev_hub", 10000)
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
    wait_scene(page, "dev_hub", 10000)
    page.wait_for_timeout(300)

    # debug menu
    press(page, "F1", 400)
    check(page.evaluate("window.__game.scene.getScene('debug').open"), "F1 opens the debug menu")
    check(page.evaluate("window.__game.scene.isPaused('dev_hub')"), "the screen pauses under the debug menu")
    page.screenshot(path=f"{out}/08_debug.png")
    press(page, "ArrowDown")
    press(page, "ArrowDown")
    press(page, "ArrowDown")  # Hitboxes
    press(page, "Enter")
    press(page, "x", 300)  # close
    check(not page.evaluate("window.__game.scene.getScene('debug').open"), "Cancel closes the debug menu")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/09_hitboxes.png")

    # ── Battle sandbox ──
    hub_open(page, 2)
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

    # ── Ring & crowd: hazards, a survival goal, a packed rowdy crowd, Hype specials ──
    sb("s.pressRow('Ring', 'confirm');")
    check(sb("return s.page;") == "ring", "the sandbox opens the Ring & crowd page")
    sb("['Lights', 'Slippery', 'Hot ropes', 'Spotlight'].forEach(l => s.pressRow(l, 'right'));")
    sb("s.pressRow('Goal', 'left'); s.pressRow('Rounds', 'left'); s.pressRow('Rounds', 'left');")
    sb("s.pressRow('Crowd', 'right'); s.pressRow('Crowd mood', 'left');")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/19b_sandbox_ring.png")
    cond = sb("return s.setup().conditions;")
    check(cond == {"hazards": ["falling_light", "slippery_canvas", "burning_ropes", "spotlight"], "goal": "survive", "rounds": 3, "crowd": "packed", "mood": "rowdy"}, f"the ring page sets the conditions ({cond})")
    sb("s.pressRow('Done', 'confirm');")
    check(sb("return s.page;") == "fight", "Done goes back to the fight rows")
    sb("s.s.assist = 3; s.pressRow('FIGHT', 'confirm');")
    wait_scene(page, "battle")
    wait_battle_input(page, "menu", 30000)
    page.screenshot(path=f"{out}/19c_ring_battle.png")
    battle_eval(page, "s.engine.hype = 10; s.menu.items.find(i => i.value === 'specials').disabled = false;")
    battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'specials'));")
    press(page, "Enter", 250)
    wait_battle_input(page, "menu")
    battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'showstopper'));")
    press(page, "Enter", 200)
    page.wait_for_timeout(500)
    page.screenshot(path=f"{out}/19d_showstopper.png")
    page.wait_for_function("(() => { const s = window.__game.scene.getScene('battle'); return s.inputState !== 'busy' || ['victory', 'defeat'].includes(s.engine.phase); })()", timeout=30000)
    log = battle_eval(page, "return s.engine.log.slice();")
    check("hero special showstopper" in log, "Chispa spends Hype on the Showstopper")
    if battle_eval(page, "return s.inputState === 'menu' && s.engine.turn;") == "partner":
        battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'appeal'));")
        press(page, "Enter", 200)
        page.wait_for_timeout(300)
        check(any(l.startswith("partner appeal") for l in battle_eval(page, "return s.engine.log.slice();")), "Pip plays to the crowd")
    phase = fight(page, out, "19e_ring")
    log = page.evaluate("window.__game.scene.getScene('battle').engine.log.slice()")
    check(phase == "victory", f"the ring fight is won ({phase})")
    check(any(l.startswith("spotlight") for l in log), "the spotlight picks someone")
    wait_scene(page, "battle_sandbox", 10000)
    press(page, "x", 300)
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
    # a picture for the rival: a figure drawn on a white background, standing and attacking
    draw = """(pose) => { const c = document.createElement('canvas'); c.width = 120; c.height = 160;
      const x = c.getContext('2d'); x.fillStyle = '#ffffff'; x.fillRect(0, 0, 120, 160);
      x.fillStyle = '#d8314b'; x.fillRect(35, 20, 50, 60); x.fillStyle = '#2a6fd8'; x.fillRect(30, 80, 60, 70);
      x.fillStyle = '#ffffff'; x.fillRect(50, 35, 8, 8);
      if (pose === 'attack') { x.fillStyle = '#f2c14e'; x.fillRect(85, 60, 30, 14); }
      return c.toDataURL('image/png'); }"""
    page.evaluate("(async () => { const d = " + draw + "; const s = window.__game.scene.getScene('fighter_maker'); await s.usePicture('idle', d('idle')); await s.usePicture('attack', d('attack')); })()")
    fm("const f = s.mine[s.mine.length - 1]; f.title = 'The Test Pattern'; f.line = 'Smile for the camera!'; s.refresh();")
    look = fm("const f = s.mine[s.mine.length - 1]; return [f.look.base, Object.keys(f.look.pictures || {}).sort()];")
    check(look == ["picture", ["attack", "idle"]], f"the maker takes uploaded pictures for a fighter ({look})")
    clean = page.evaluate("""(async () => {
      const f = window.__game.scene.getScene('fighter_maker').mine.at(-1);
      const img = new Image(); img.src = f.look.pictures.idle; await img.decode();
      const c = document.createElement('canvas'); c.width = img.width; c.height = img.height;
      const x = c.getContext('2d'); x.drawImage(img, 0, 0);
      return [img.width, img.height, x.getImageData(0, 0, 1, 1).data[3]]; })()""")
    check(clean[0] == 60 and clean[1] == 130 and clean[2] == 0, f"the upload is cropped to the figure with the white background cleared ({clean})")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{out}/25_maker.png")
    fm("s.previewAnim = 'chop'; s.refresh();")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/25b_maker_attack_pose.png")
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
    rival = battle_eval(page, "const v = s.views.get('e0'); return [v.sprite.texture.key, v.sprite.flipX, s.anims.exists('spr_custom_c_me_f2:chop'), s.engine.log.includes('quote e0')];")
    check(rival == ["spr_custom_c_me_f2", True, True, True], f"the rival fights in its picture, facing the hero, says its line ({rival})")
    page.screenshot(path=f"{out}/26_maker_battle.png")
    phase = fight(page, out, "27_maker")
    check(phase == "victory", f"the made fighters fight it out ({phase})")
    wait_scene(page, "battle_sandbox", 10000)
    page.wait_for_timeout(300)
    page.evaluate("window.__game.scene.getScene('battle_sandbox').saveEncounter('Maker Bout')")
    page.wait_for_timeout(400)
    built = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.builds') || '{}')")
    check([e["title"] for e in built.get("encounters", [])] == ["Maker Bout"] and len(built.get("fighters", [])) == 2, "the sandbox saves the fight as an encounter (fighters kept)")
    page.evaluate("window.__game.scene.getScene('battle_sandbox').leave()")
    wait_scene(page, "dev_hub")

    # ── Item maker: a damage-everyone item, used in a fight ──
    hub_open(page, 4)
    wait_scene(page, "item_maker")
    page.wait_for_timeout(400)
    im = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('item_maker'); {js} }})()")
    im("s.addItem(); Object.assign(s.mine[s.mine.length - 1], { name: 'Ring Bell', kind: 'damage', amount: 2, target: 'all' }); s.refresh();")
    page.screenshot(path=f"{out}/27b_item_maker.png")
    im("s.tryIt();")
    wait_scene(page, "battle_sandbox", 10000)
    bag = page.evaluate("window.__game.scene.getScene('battle_sandbox').s.items")
    check("c.me.i1" in bag, f"TRY puts the made item in the sandbox bag ({bag})")
    page.evaluate("(() => { const s = window.__game.scene.getScene('battle_sandbox'); s.s.items = ['c.me.i1']; s.pressRow('FIGHT', 'confirm'); })()")
    wait_scene(page, "battle", 10000)
    wait_battle_input(page, "menu")
    hp_before = battle_eval(page, "return s.engine.enemies().map(f => f.hp);")
    battle_eval(page, "s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'items'));")
    press(page, "Enter", 400)
    battle_eval(page, "s.menu.setCursor(0);")
    press(page, "Enter", 300)
    page.wait_for_function("window.__game.scene.getScene('battle').engine.log.some(l => l.startsWith('item hero c.me.i1 all'))", timeout=15000)
    page.wait_for_timeout(1500)
    hp_after = battle_eval(page, "return s.engine.enemies(false).map(f => f.hp);")
    check(all(b - a >= 1 for b, a in zip(hp_before, hp_after)), f"the made item hits every opponent ({hp_before} -> {hp_after})")
    fight(page, out, "27c_item")
    wait_scene(page, "battle_sandbox", 10000)
    page.evaluate("window.__game.scene.getScene('battle_sandbox').leave()")
    wait_scene(page, "dev_hub")

    # ── Encounters: play the saved one ──
    hub_open(page, 5)
    wait_scene(page, "encounters")
    page.wait_for_timeout(400)
    en = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('encounters'); {js} }})()")
    sel = en("return s.entries()[s.selected].title;")
    check(sel == "Maker Bout", f"Encounters opens on your own encounter ({sel})")
    page.screenshot(path=f"{out}/28_encounters.png")
    en("s.play();")
    wait_scene(page, "battle", 10000)
    phase = fight(page, out, "29_encounter")
    wait_scene(page, "encounters", 10000)
    page.wait_for_timeout(300)
    res = en("return s.lastResult;")
    rec = page.evaluate("JSON.parse(localStorage.getItem('kid-chispa.records') || '{}')")
    check(res and res["result"] == "win" and any(r["wins"] == 1 for r in rec.values()), f"playing an encounter records the win ({res})")
    page.screenshot(path=f"{out}/30_encounter_result.png")
    en("s.leave();")
    wait_scene(page, "dev_hub")

    # ── Move maker: an attack on everyone, tried in the sandbox ──
    hub_open(page, 6)
    wait_scene(page, "move_maker")
    page.wait_for_timeout(400)
    mm = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('move_maker'); {js} }})()")
    mm("s.addMove('hero'); Object.assign(s.mine[s.mine.length - 1], { name: 'Tornado DDT', gritCost: 0, power: 2 }); s.refresh();")
    mm("s.pressRow('Target', 1); s.pressRow('Target', 1);")
    tgt = mm("return s.mine[s.mine.length - 1].target;")
    check(tgt == "all", f"the move maker sets a move on everyone ({tgt})")
    page.screenshot(path=f"{out}/30b_move_maker.png")
    mm("s.tryIt();")
    wait_scene(page, "battle_sandbox", 10000)
    hero = page.evaluate("window.__game.scene.getScene('battle_sandbox').s.hero")
    check(hero == "c.try.hero", f"TRY puts a hero who knows the move in the sandbox ({hero})")
    page.evaluate("(() => { const s = window.__game.scene.getScene('battle_sandbox'); s.s.preset = 0; s.pressRow('Line-up', 'confirm'); s.s.cond = {}; s.s.assist = 3; s.pressRow('FIGHT', 'confirm'); })()")
    wait_scene(page, "battle", 10000)
    wait_battle_input(page, "menu")
    first = battle_eval(page, "return s.menu.items[0].value;")
    check(first == "move:c.me.m1", f"the made move is on the menu ({first})")
    press(page, "Enter", 300)
    page.wait_for_function("window.__game.scene.getScene('battle').engine.log.filter(l => l.startsWith('hero c.me.m1 ')).length >= 2", timeout=15000)
    page.screenshot(path=f"{out}/30c_move_in_battle.png")
    check(True, "the made move hits every opponent")
    fight(page, out, "30d_move")
    wait_scene(page, "battle_sandbox", 10000)
    page.evaluate("window.__game.scene.getScene('battle_sandbox').leave()")
    wait_scene(page, "dev_hub")

    # ── Community gallery: browse by kind, copy to remix, play an encounter ──
    hub_open(page, 7)
    wait_scene(page, "gallery")
    page.wait_for_function("window.__game.scene.getScene('gallery').ready", timeout=10000)
    ga = lambda js: page.evaluate(f"(() => {{ const s = window.__game.scene.getScene('gallery'); {js} }})()")
    enc = ga("return s.list().map(c => c.name);")
    check("Maker Bout" in enc, f"the gallery lists the saved encounter ({enc})")
    page.screenshot(path=f"{out}/30e_gallery_fights.png")
    ga("s.setKind('fighter');")
    page.wait_for_timeout(200)
    page.screenshot(path=f"{out}/30f_gallery_fighters.png")
    ga("s.setKind('move');")
    names = ga("return s.list().map(c => c.name);")
    check("Tornado DDT" in names, f"the gallery lists made moves ({names})")
    ga("s.copy();")
    page.wait_for_function("window.__game.scene.getScene('gallery').status.startsWith('Copied')", timeout=8000)
    n = ga("return s.list().filter(c => c.name === 'Tornado DDT').length;")
    check(n == 2, f"COPY makes it yours to remix ({n} copies)")
    page.screenshot(path=f"{out}/30g_gallery_moves.png")
    ga("s.setKind('encounter'); s.selected = s.list().findIndex(c => c.name === 'Maker Bout'); s.play();")
    wait_scene(page, "encounters")
    sel = page.evaluate("(() => { const s = window.__game.scene.getScene('encounters'); return s.entries()[s.selected].title; })()")
    check(sel == "Maker Bout", f"PLAY opens that encounter ({sel})")
    page.evaluate("window.__game.scene.getScene('encounters').leave()")
    wait_scene(page, "dev_hub")
    page.evaluate("window.__game.scene.getScene('dev_hub').children.list.find(o => o.setCursor)?.setCursor(0)")

    for i, (name, shot) in enumerate(
        [("input_test", "10_input"), ("ui_kit", "11_ui_kit"), ("anim_test", "12_anim"), ("data_report", "13_data")], start=9
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

    # ── Sprite studio: a sprite sheet skin for Kid Chispa, worn in a fight ──
    import base64 as _b64
    starter = "data:image/png;base64," + _b64.b64encode(open("art/templates/starter_kid_chispa_96.png", "rb").read()).decode()
    page.evaluate("(() => { const g = window.__game; g.scene.stop('dev_hub'); g.scene.start('sprite_studio'); })()")
    wait_scene(page, "sprite_studio")
    studio = lambda js: page.evaluate("(async () => { const s = window.__game.scene.getScene('sprite_studio'); " + js + " })()")
    studio(f"await s.useSheet('{starter}');")
    cut = studio("const x = s.sheet(); return [x.frameW, x.frameH, Object.keys(x.anims).join(',')];")
    check(cut == [96, 96, "idle,walk,chop,hurt"], f"the studio cuts a sheet into frames and finds its animations ({cut})")
    studio("s.sel = 'win'; s.clickCell(0); s.clickCell(1); return 0;")
    win = studio("return s.sheet().anims.win;")
    check(win and win["start"] == 0 and win["count"] == 2, f"clicking cells sets an animation ({win})")
    page.screenshot(path=f"{out}/18_sprite_studio.png")
    check(studio("return await s.save();"), "the skin saves")
    page.evaluate("(() => { const g = window.__game; g.scene.stop('sprite_studio'); g.scene.start('battle', { formation: 'test_goons', firstStrike: null, returnTo: 'dev_hub' }); })()")
    wait_battle_input(page, "menu", 30000)
    hero = battle_eval(page, "const v = s.views.get('hero'); return [v.texture, v.sprite.frame.name.split('_')[0], s.anims.exists('spr_skin_chispa:win')];")
    check(hero == ["spr_skin_chispa", "idle", True], f"Kid Chispa fights in the skin, with its animations ({hero})")
    page.screenshot(path=f"{out}/18b_skin_battle.png")
    page.evaluate("(() => { const g = window.__game; g.scene.stop('battle'); g.scene.start('sprite_studio'); })()")
    wait_scene(page, "sprite_studio")
    studio("s.skins = {}; return await s.save();")
    page.evaluate("(() => { const g = window.__game; g.scene.stop('sprite_studio'); g.scene.start('dev_hub'); })()")
    wait_scene(page, "dev_hub")

    # ── Boss: walks in with a name card, gets serious at half HP ──
    page.evaluate("(() => { const g = window.__game; g.scene.stop('dev_hub'); g.scene.start('battle', { formation: 'test_boss', firstStrike: null, returnTo: 'dev_hub' }); })()")
    wait_scene(page, "battle")
    page.wait_for_timeout(3500)
    page.screenshot(path=f"{out}/19_boss_entrance.png")
    wait_battle_input(page, "menu", 30000)
    log = battle_eval(page, "return s.engine.log.slice(0, 4);")
    check(log[:2] == ["entrance e0", "quote e0"], f"the huge boss walks in and says its line ({log[:2]})")
    battle_eval(page, "const b = s.engine.get('e0'); s.engine.damage('e0', Math.ceil(b.maxHp / 2)); return 0;")
    page.wait_for_timeout(200)
    seen = battle_eval(page, "return [s.engine.get('e0').attack, s.engine.get('e0').ai === null];")
    battle_eval(page, "s.showPhaseChanges(); return 0;")
    page.wait_for_timeout(900)
    page.screenshot(path=f"{out}/19b_boss_phase2.png")
    check(seen[0] == 3, f"at half HP the boss enters phase 2 and hits harder ({seen})")
    page.evaluate("(() => { const g = window.__game; g.scene.stop('battle'); g.scene.start('dev_hub'); })()")
    wait_scene(page, "dev_hub")

    # crash screen
    page.wait_for_timeout(600)
    press(page, "x")
    wait_scene(page, "title")
    press(page, "F8", 400)
    check(page.evaluate("!!document.getElementById('crash')"), "F8 on the title shows the crash screen")

    # ── Battle Maker: build on the ring, the clear check, upload, then play it from the Battle World ──
    page.reload()
    wait_scene(page, "title", 15000)
    page.wait_for_timeout(600)
    press(page, "Enter", 600)
    page.wait_for_function("!!window.__game.scene.getScene('title').doors", timeout=5000)
    press(page, "ArrowRight", 200)
    press(page, "Enter")
    wait_scene(page, "battle_maker")
    page.wait_for_timeout(500)
    mk = lambda js: page.evaluate("(async () => { const s = window.__game.scene.getScene('battle_maker'); " + js + " })()")
    mk("s.newBattle(); return 0;")
    wait_scene(page, "battle_maker")
    foes = mk("return s.draft.setup.enemies.map(e => e.id);")
    check(foes == ["dock_goon", "dock_goon"], f"MAKE opens on a new battle: Kid Chispa against two goons ({foes})")
    mk("s.addFoe('spiky_bouncer'); return 0;")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{out}/30_maker.png")
    check(mk("return s.draft.setup.enemies.length;") == 3, "picking an opponent puts it in the ring")
    mk("await s.upload(); return 0;")
    check("Clear check" in mk("return s.status;"), "UPLOAD asks for a clear first")
    mk("s.playTest(); return 0;")
    wait_scene(page, "battle")
    page.evaluate("window.__debug.set('god', true)")  # a play-test sets the switches; turn god mode on inside the fight
    phase = fight(page, out, "31_test")
    page.evaluate("window.__debug.set('god', false)")
    wait_scene(page, "battle_maker", 10000)
    page.wait_for_timeout(300)
    check(phase == "victory" and mk("return s.cleared();"), f"winning the play-test clears the battle ({phase})")
    page.screenshot(path=f"{out}/32_cleared.png")
    mk("s.draft.setup.items = []; s.changed(); return 0;")
    check(not mk("return s.cleared();"), "changing it after the clear needs a new clear")
    mk("s.draft.setup.items = ['water_bottle']; s.changed(); return 0;")
    check(mk("return s.cleared();"), "putting it back as it was cleared counts again")
    mk("s.draft.title = 'Smoke Bout'; return 0;")
    check(mk("return await s.save(true);"), "the cleared battle uploads")
    page.evaluate("(() => { const g = window.__game; g.scene.stop('battle_maker'); g.scene.start('play'); })()")
    wait_scene(page, "play")
    pl("s.setTab('world'); return 0;")
    world = pl("return s.entries().map(e => e.title);")
    check("Smoke Bout" in world, f"the upload is in the Battle World ({world})")
    page.wait_for_timeout(300)
    page.screenshot(path=f"{out}/33_world.png")
    pl("s.details(s.entries().find(e => e.title === 'Smoke Bout')); s.playOpen(); return 0;")
    wait_scene(page, "battle")
    page.evaluate("window.__debug.set('god', true)")
    phase = fight(page, out, "34_world")
    page.evaluate("window.__debug.set('god', false)")
    wait_scene(page, "play", 10000)
    page.wait_for_function("!!window.__game.scene.getScene('play').result", timeout=8000)
    page.wait_for_timeout(500)
    plays = pl("const k = s.open.key; return [k, s.result.result];")
    check(plays[1] == "win", f"a Battle World fight is played and recorded ({plays})")

    # losing: Smelling Salts first, then back to the Battle World (there is no Game Over)
    pl("s.close(); s.setTab('showcase'); s.details(s.entries().find(e => e.key === 'show:main_event')); s.playOpen(); return 0;")
    wait_scene(page, "battle")
    revived = False
    for _ in range(120):
        if not active(page, "battle"):
            break
        st = page.evaluate("(() => { const s = window.__game.scene.getScene('battle'); return [s.inputState, s.engine.log.some(l => l.startsWith('revive hero smelling_salts'))]; })()")
        revived = revived or st[1]
        if st[0] == "menu":
            battle_eval(page, "s.engine.hero.hp = Math.min(s.engine.hero.hp, 1); s.menu.setCursor(s.menu.items.findIndex(i => i.value === 'defend'));")
            press(page, "Enter", 300)
        else:
            page.wait_for_timeout(300)
    check(revived, "Smelling Salts get Chispa back up when he's knocked out")
    wait_scene(page, "play", 15000)
    page.wait_for_function("!!window.__game.scene.getScene('play').result", timeout=8000)
    check(pl("return s.result.result;") == "lose", "a lost fight goes back to the Battle World with the result")
    page.screenshot(path=f"{out}/35_lost.png")

    # your battles are still there after a reload
    page.reload()
    wait_scene(page, "title", 15000)
    page.wait_for_timeout(600)
    press(page, "Enter", 600)
    page.wait_for_function("!!window.__game.scene.getScene('title').doors", timeout=5000)
    press(page, "Enter")
    wait_scene(page, "play")
    pl("s.setTab('mine'); return 0;")
    mine = pl("return s.entries().map(e => [e.title, !!e.draft]);")
    check(["Smoke Bout", False] in mine, f"YOURS keeps the uploaded battle after a reload ({mine})")
    real = [e for e in errors if "fonts.g" not in e and "ERR_" not in e and "Test crash" not in e]
    check(not real, f"no errors on desktop {real[:3]}")
    ctx.close()

    b.close()

srv.shutdown()
print("RESULT:", "FAIL" if failures else "PASS", f"({len(failures)} failed)" if failures else "")
sys.exit(1 if failures else 0)
