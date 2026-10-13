# Kid Chispa and the Seven Belts

A turn-based wrestling RPG in the style of *Paper Mario: The Thousand-Year Door*, in pixel art, built as a web game with Phaser 3 and TypeScript. Battles happen in a ring in front of a crowd; ring props are the items.

It's a PC game: it runs in a desktop browser with keyboard or gamepad (the planned desktop build wraps the same code). Every build is a single self-contained HTML file that is published as a playable link.

## Status

| Milestone | State |
| --- | --- |
| M0 Skeleton: build, loader, placeholder art, crash reports | Done |
| Shared foundations: data, state, events, input, UI kit, transitions, debug menu | Done |
| Overworld core: 3D-style rooms, camera, jumping, field enemies, First Strike, gates, people, signs, chests, heal blocks, story triggers, locked doors | Mostly done (partner follower to come) |
| M1 Battle system | Done for now: turns and damage, action commands, Block and Reversal, enemy patterns, results screen, arena and camera overhaul, battle sandbox. Still to come at M1: the battle HUD's crowd/Hype parts and more input types |
| M2 Prologue playable | Planned |

The full task list and milestone plan live in the project's *Programming List* doc; the art, audio and story plan in the *Asset Outline* doc.

## Running it

Needs Node 20 or newer.

```bash
npm install
npm run dev          # local dev server with hot reload
npm run build        # type-check, unit tests, then dist/index.html and dist/play.html
npm test             # unit tests (Vitest)
npm run test:browser # headless browser walkthrough of the built game (needs Python + Playwright)
npm run lint
npm run format
```

`dist/play.html` is the same build with the outer page tags removed, ready to publish as an artifact.

## Controls

| Action | Keyboard | Gamepad | Touch |
| --- | --- | --- | --- |
| Move | Arrows / WASD | D-pad / left stick | On-screen d-pad |
| Confirm / Jump | Z, Space, Enter | A | A |
| Cancel / Strike | X, Backspace | B | B |
| Partner | C | X / Y | C |
| Menu | Esc, Tab | Start | M |
| Debug menu (dev builds) | F1 | | Triple-tap top-left corner |
| Test crash screen | F8 on the title | | |

## How the game is laid out

```
src/
  main.ts            game config: 640×360, pixel art, integer scaling
  scenes/            title, dev hub, field, battle, battle sandbox, room editor, overlays (debug, curtain)
  field/             the 3D world: units, projection, movement, room drawing
  battle/            battle system (M1)
  ui/                pixel panels, menus, bars, fonts, theme colours
  systems/           input, RNG, animation builder, placeholder art, crash overlay
  managers/          Database, GameState, EventBus, SceneLoader, strings, asset packs
  data/              all game data as JSON (characters, enemies, moves, items, formations, rooms, rules)
  strings/           en.json, es.json
  types/             TypeScript types for every data file
public/assets/       art and audio (atlases, tilesets, fonts, music, sfx)
tests/               unit tests
tools/               build helper and the browser smoke test
```

### Rules the code follows

- **Data, not code.** Stats, moves, items, battle line-ups and rooms are JSON. The Database checks every file at start-up and the dev hub's *Data report* lists broken references by file and id.
- **One input layer.** Game code asks for actions (`confirm`, `jump`, `strike`…), never keys, so keyboard, gamepad and touch always behave the same.
- **Events over wiring.** Systems announce changes on the EventBus (`hp.changed`, `coins.changed`…) instead of calling each other.
- **Everything in the field is measured in world units.** See below.
- **Text is never hard-coded** in player-facing screens: it comes from `src/strings` in English and Spanish. (The dev-hub test screens are English-only.)

### The world unit

Rooms are 3D spaces seen through a perspective camera, like TTYD's field camera:

- **x** runs left to right, **z** is depth (0 = front edge, larger = farther back), **y** is height.
- **1 unit = 32 px** across the screen at the front edge of the floor. Farther back, everything is drawn smaller and pulled toward the middle of the screen (`perspective` in `world.json`; 0 turns it off). Floors converge, side walls show, and near things slide past faster than far ones as the camera scrolls.
- **Sprites shrink with depth in clean steps** (`spriteScaleStep`, 1/16) so pixel art doesn't shimmer as characters walk back and forth.
- **A screen is 20 units wide.** Rooms are a whole number of screens wide and as deep as needed; the camera scrolls on both axes.
- **Depth cues** set per room: things fade into the room's haze toward the back (`fog`, strength `fogMax`), `lights` make pools and shafts of light on the floor that also lift characters out of the haze, and `foreground` silhouettes (pillars, crowd, railings) sit between the camera and the room and turn see-through when the player walks behind them. The backdrop has three layers scrolling at different speeds.
- A room's floor is any **convex outline**: a rectangle, an octagon from a single corner-cut number, or a list of points. Walls, cage fences, the stage lip and gates follow the outline.
- Blocks (crates, steps, platforms, the ring) have width, depth and height in units. Anything up to 0.3 units high is climbed by walking; a jump reaches about 1.6 units.

All of these numbers are in `src/data/world.json`; field rules such as the flee grace period are in `src/data/rules.json`.

## What a room can hold

Rooms live in `src/data/rooms/` (any number of files, each a set of rooms by id; one per chapter later) and are checked at start-up like all other data: exits must lead to a real room and spawn point, enemies and formations must exist, chests must name a real item, and so on.

Besides blocks, doors and enemies, a room has `objects`:

| Kind | What it does |
| --- | --- |
| `npc` | Someone to talk to: sprite, name, lines (string keys); can set a flag once you've heard them out. |
| `sign` | Lines to read. |
| `chest` | Gives an item once; its `flag` remembers it was opened. |
| `heal` | Restores the party's HP and Grit. |
| `trigger` | An invisible area that fires when walked into: sets a flag and/or shows lines. Once only by default. |

Walk up to a person or thing and a **!** appears over it; the jump button (Z / A) talks or opens instead of jumping. Text shows in a simple message box for now (the dialogue system with bubbles and choices comes later).

**Story flags drive the rooms.** Any door, enemy or object can carry `if` (only while a flag is set) and `unless` (only while it isn't), so a character can say something different after an event, or disappear. Doors and gates can be locked with `requires` (a flag) and `lockedText`. Enemies with `"respawn": false` are story fights: once beaten they stay gone (a `beaten:<room>:<id>` flag). The debug menu's flag list shows every flag the rooms use.

The test rooms show all of it: in room B the kid unlocks the Octagon gate when you talk to him (and says something else afterwards), plus a sign, a chest and a heal block; room A has a one-time trigger by its east door; the Bruiser crew in the Octagon is a story fight.

## Saving

The title screen opens a menu when you press Start: **Continue** (the newest save), **New game**, **Load game** (pick a slot) and **Dev hub**. A new game starts in the room set in `rules.json` (`newGame`), a grey-box room until the Prologue exists.

- **Autosave**: entering any room saves to the Autosave slot.
- **Save blocks** (`"kind": "save"` in a room, or the editor's *save* tool) let you pick one of three slots.
- In the game link, saves are kept in your own private space in the link's database, so they follow you to any browser and nobody else can see them; elsewhere they use the browser's storage.
- Every save carries a format version. When the save format changes, the version goes up and a small upgrade step in `MIGRATIONS` (`game_state.ts`) brings older saves forward, so saves from earlier builds keep loading.

## Losing

When Chispa is knocked out, anything in the bag that revives (Smelling Salts: back up with 5 HP) is used by itself and the fight goes on; such items can't be picked from the menu. Otherwise it's **Game Over**: the fight and the room close, and the Game Over screen offers **Continue from last save** (the newest save, usually the autosave from entering the room) or **Back to title**.

A fight the story lets you lose has `"loseOk": true` in its formation (or `loseOk` when started from a scene): Chispa gets back up and the game goes on. Sandbox fights never end the game. A knocked-down partner never causes a Game Over.

## Room editor

Dev hub → *Room editor* (or **F2** while walking around a room) is where rooms get built. It shows the room as a top-down plan: the back wall at the top, the front edge (where the game camera stands) at the bottom, one grid square per unit, an amber line at every screen.

- **Tools** (right panel): select, block, light, spawn, exit, enemy, person, sign, chest, heal, trigger. Pick one and click the plan to place it; it's then selected so you can set it up.
- **Select** to pick, drag to move (snaps to half units, hold Shift for tenths), drag the white corner to resize blocks, triggers and lights. Delete removes, Ctrl+D copies, Ctrl+Z undoes, arrow keys nudge, `[` `]` change a block's height. Right-drag or drag empty space to pan, mouse wheel to zoom.
- **Properties** (right panel): click `<` `>` to step a value (Shift for bigger steps), click a blue value to type it. People's and signs' lines are typed straight in, one line per text box, in English and (separately) Spanish. Flag fields take any flag name.
- With nothing selected, the panel shows the room itself: name, look (harbor, warehouse, arena), screens, depth, wall height, rectangle or octagon, fence, and any problems the room checker finds.
- **PLAY** (or P) walks into the room as it is now, from the selected spawn point or `start`; **F2** comes back. **NEW** makes an empty room, **REVERT** throws away saved changes.
- **SAVE** (Ctrl+S): in the published game link, rooms are saved to the link's own database, so everyone who opens the link gets them and Claude can read them back into `src/data/rooms/`. Running locally they're saved in the browser instead. The game lays saved rooms over the shipped ones at start-up.

## Battle presentation

Fights take place in a perspective arena (`src/battle/stage.ts`): a raised ring with corner posts, turnbuckles and ropes, ringside mats and a barricade, crowd stands behind and on both sides, and a lighting rig. Everything is placed with `P(X, Y, Z)` in arena units; fighters stand on one depth line at their pixel size, so the art is never resized by the perspective. Static parts are drawn once into images for speed.

Chispa starts on the left of the ring with the opponents across from him. The camera (`src/battle/camera_director.ts`) eases between shots rather than cutting: an establishing sweep from the crowd down to the ring, a command view that keeps Chispa clear of the menu, a pan to the chosen target, a tracking shot that follows the attacker across the ring, a punch-in on every impact (bigger for big hits), and close-ups for victory and defeat. Big hits and knockouts make the crowd jump. The HUD, menus and banners sit on a separate fixed layer, so they never pan or zoom.

## Action commands

Every hero move has a timing challenge. The rules are in `src/battle/commands.ts`, the numbers in `src/data/battle_rules.json`.

| Command | Move | How it works | Result |
| --- | --- | --- | --- |
| Double jump (`stomp`) | Elbow Drop | Press just before landing on the opponent. Pressing too early locks you out. | Success bounces you up for another hit; a miss ends the move after this hit. |
| Precision press (`timed_press`) | Chop | A ring closes on the target; press as it lines up. | GREAT ×1.5 damage, NICE ×1, miss ×0.5. |
| Precision release (`hold_release`) | Body Slam | Hold to fill the bar, release in the lit zone. Holding too long fizzles. | GREAT ×1.5, NICE ×1, miss ×0.5. |
| Block (`guard`, A) | Any enemy attack | Press A just before the hit lands (130 ms window). | 1 less damage. |
| Reversal (`guard`, B) | Any enemy attack | Press B in a tighter window (60 ms). | No damage, and the attacker takes 1. |

Commands work with Z / Enter / Space, gamepad A, the on-screen A button, or a tap anywhere on the stage. For guarding, only the first press counts: pressing during the wind-up locks you out. The debug menu's *Perfect commands* switch makes every command succeed (and auto-blocks).

## Enemy patterns

Each enemy's `ai` list in `src/data/enemies.json` is a set of rules. Every turn the rules whose conditions hold are collected, the highest `priority` wins, and `weight` picks between equals. Conditions: `whenHpBelow` (own HP fraction), `whenAllyHpBelow` (a teammate's), `fromRound` and `everyRounds`.

- **Charged moves** (`charge` in moves.json) take a turn to wind up: the enemy glows and a WINDING UP! warning shows, then it lets go next turn. A GREAT action command on a charging enemy staggers it and cancels the charge. The Ringside Bruiser winds up a Running Lariat every other round.
- **Support moves** (`heal`, target `ally_lowest`) heal the most hurt teammate. The Corner Medic only patches up someone below 75% HP, from the back row, so Elbow Drop is the way to reach him.
- A small caption names each enemy move as it starts.

The *test_crew* line-up (Bruiser, Goon, Medic) is in the debug menu's battle list and patrols the octagon room.

## Winning

After a win, the results panel lists who was beaten and their XP, the coins, and the XP bar filling toward the next level (XP to next level = 10 + 5 × (level − 1), in `battle_rules.json`). A level up fully restores HP and Grit. The panel waits for a button press.

## Partners in battle

A partner (Pip first) fights next to Chispa, a step in front of him. Each round Chispa acts, then the partner, then the enemies. The partner has his own HP (shown in a second panel), his own moves from `characters.json`, uses items on himself and can Defend; only Chispa can run. Grit is shared.

Enemy attacks go for the partner 40% of the time while he's standing (`partnerTargetChance` in `battle_rules.json`); Block and Reversal work for either. A partner at 0 HP lies flat and skips his turns, and gets back up with 1 HP after the fight (`partnerReviveHp`). The fight is lost only when Chispa goes down.

Pip's moves: **Mic Drop** (timed press, reaches flyers) and **Scout**, which shows an opponent's HP, attack, defence and Pip's notes. For testing, the debug menu's *Pip in party* switch brings him along in field fights, and the sandbox has a *Partner* row.

## Fighter maker

The game is growing into a Paper Mario-style **battle builder**: make your own fighters and encounters and share them. Step 1 is the fighter maker (dev hub → *Fighter maker*).

- **+HERO / +ENEMY** start a new fighter; anything in the list (yours, the community's, or built-in) can be **COPY**'d and changed.
- **Look**: the animated wrestler body in your own colours (skin, mask, shirt, trunks, boots), or any existing sprite.
- **Stats**: HP, attack, defence; heroes have Grit; enemies have XP and coin rewards, can be spiky or flying, and have Scout text.
- **Moves**: heroes switch hero moves on and off; enemies give each enemy move a weight (how often it's picked) and can have a move they always use when hurt (at half HP or below).
- **SAVE** (Ctrl+S) checks the fighter like any game data, then stores your set. In the game link it goes to `builds/<your id>` in the link's database: everyone who opens the link can see and copy your fighters (the COMMUNITY list), only you can change them. Elsewhere it's kept in the browser.
- **TRY** opens the battle sandbox with the fighter in place: as the hero, or as the first opponent. The sandbox has a **Hero** row, so any hero can lead a fight (with any partner).

At start-up every saved fighter becomes normal game data (`c.<owner>.<id>`), so battles, the sandbox and the simulator treat them exactly like built-in ones.

Coming next in the builder: saved encounters, items, stage conditions, the crowd and Hype, a move maker, and a community gallery.

## Battle sandbox

Dev hub → *Battle sandbox* is the balancing bench. Build a fight from any enemies (up to 4, front or back row; flyers stay in the air), start from any line-up in `formations.json`, pick the arena look, and set Chispa's HP, attack, defence and Grit, the First Strike, assists (Perfect commands, god mode) and the seed (random, or the last fight's seed to replay it).

- **FIGHT!** plays it. Afterwards the panel shows the result, rounds, damage dealt and taken, how the action commands and guards went, and the seed. The save, the debug switches and Chispa's real stats are put back exactly as they were.
- **Simulate ×200** fights it 200 times without graphics (`src/battle/simulate.ts`) through the real battle engine. The hero picks the move and target that do the most expected damage, going for healers and charging enemies first; the timing is rolled from a skill level: Perfect, Skilled, Casual or None. It reports the win rate, rounds per win, HP left and damage taken.
- Hazards are listed but greyed out until they exist (M3).

### Arena looks

`src/data/stages.json` holds the colours for each arena (backdrop, stands, how full they are, barricade, mats, apron, canvas, posts, turnbuckles, ropes, lights). A formation's `stage` picks one: *Grand Arena*, *Harbor Docks* (night, sparse crowd, white ropes) and *Underground Circuit* (dim, yellow ropes, black apron).

## Testing

- `npm test` runs unit tests for the battle engine, action commands, enemy patterns, levels, the simulator, the RNG, EventBus, GameState, the Database validator, the animation builder and the world rules (collision, stairs, jumping, slanted walls, gates, camera).
- `npm run test:browser` builds nothing itself: run `npm run build` first. It opens the game headless at desktop and phone sizes and plays through title → dev hub → field → battle → back, the flee grace period, every room and gate, the debug menu, each test screen and the crash screen.

## Art

There is no final art yet. Missing sprites are drawn as labelled coloured boxes at their declared size (see `src/data/packs`), and a code-drawn test wrestler stands in for Kid Chispa. Characters, names and art are all original.
