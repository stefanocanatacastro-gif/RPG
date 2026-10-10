# Kid Chispa and the Seven Belts

A turn-based wrestling RPG in the style of *Paper Mario: The Thousand-Year Door*, in pixel art, built as a web game with Phaser 3 and TypeScript. Battles happen in a ring in front of a crowd; ring props are the items.

It runs in any browser on computer or phone. Every build is a single self-contained HTML file that is published as a playable link.

## Status

| Milestone | State |
| --- | --- |
| M0 Skeleton: build, loader, placeholder art, crash reports | Done |
| Shared foundations: data, state, events, input, UI kit, transitions, debug menu | Done |
| Overworld core: 3D-style rooms, camera, jumping, field enemies, First Strike, gates | Mostly done |
| M1 Battle system | In progress: steps 1–2 of 4 done (turns and damage; action commands) |
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
  scenes/            title, dev hub, field, battle, overlays (touch controls, debug, curtain)
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

Rooms are 3D spaces drawn from a fixed camera angle, like TTYD's field camera:

- **x** runs left to right, **z** is depth (0 = front edge, larger = farther back), **y** is height.
- **1 unit = 32 px** across the screen. Depth is drawn at half scale; height at full scale. Nothing is resized, so pixel art stays crisp.
- **A screen is 20 units wide.** Rooms are a whole number of screens wide and as deep as needed; the camera scrolls on both axes.
- A room's floor is any **convex outline**: a rectangle, an octagon from a single corner-cut number, or a list of points. Walls, cage fences, the stage lip and gates follow the outline.
- Blocks (crates, steps, platforms, the ring) have width, depth and height in units. Anything up to 0.3 units high is climbed by walking; a jump reaches about 1.6 units.

All of these numbers are in `src/data/world.json`; field rules such as the flee grace period are in `src/data/rules.json`.

## Action commands

Every hero move has a timing challenge. The rules are in `src/battle/commands.ts`, the numbers in `src/data/battle_rules.json`.

| Command | Move | How it works | Result |
| --- | --- | --- | --- |
| Double jump (`stomp`) | Elbow Drop | Press just before landing on the opponent. Pressing too early locks you out. | Success bounces you up for another hit; a miss ends the move after this hit. |
| Precision press (`timed_press`) | Chop | A ring closes on the target; press as it lines up. | GREAT ×1.5 damage, NICE ×1, miss ×0.5. |
| Precision release (`hold_release`) | Body Slam | Hold to fill the bar, release in the lit zone. Holding too long fizzles. | GREAT ×1.5, NICE ×1, miss ×0.5. |

Commands work with Z / Enter / Space, gamepad A, the on-screen A button, or a tap anywhere on the stage. The debug menu's *Perfect commands* switch makes every command succeed.

## Testing

- `npm test` runs unit tests for the RNG, EventBus, GameState, the Database validator, the animation builder and the world rules (collision, stairs, jumping, slanted walls, gates, camera).
- `npm run test:browser` builds nothing itself: run `npm run build` first. It opens the game headless at desktop and phone sizes and plays through title → dev hub → field → battle → back, the flee grace period, every room and gate, the debug menu, each test screen and the crash screen.

## Art

There is no final art yet. Missing sprites are drawn as labelled coloured boxes at their declared size (see `src/data/packs`), and a code-drawn test wrestler stands in for Kid Chispa. Characters, names and art are all original.
