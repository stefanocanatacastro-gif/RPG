# Kid Chispa: Battle Maker — itch.io page

Everything to fill in on itch.io's "Create a new project" form, in the form's order.

## Basics

| Field | Value |
|---|---|
| Title | Kid Chispa: Battle Maker |
| Project URL | kid-chispa-battle-maker |
| Short description or tagline | Make wrestling battles, beat them, share them. Turn-based fights with timed button presses. |
| Classification | Games |
| Kind of project | HTML |
| Release status | In development |
| Pricing | No payments |

## Uploads

1. Upload `kid-chispa-itch-<version>.zip`.
2. Tick **This file will be played in the browser**.

## Embed options

| Field | Value |
|---|---|
| Embed in page / Click to launch in fullscreen | Embed in page |
| Viewport dimensions | 960 × 540 |
| Mobile friendly | On, orientation: Landscape |
| Automatically start on page load | Off (keep Click to Play) |
| Fullscreen button | On |
| Enable scrollbars | Off |
| SharedArrayBuffer support | Off |

## Details

**Description** (paste as is):

> **Build a wrestling battle. Beat it. Share it.**
>
> Kid Chispa: Battle Maker is a turn-based wrestling game where every fight is a level: pick the opponents, the ring, the crowd and the rules, then step in and win it.
>
> **PLAY**
> - Seven showcase fights, from a dockside warm-up to a two-boss main event.
> - Timed button presses power up every attack and let you block or reverse hits.
> - Bosses walk to the ring to a roaring crowd, and get serious at half health.
> - Hazards: falling lights, a slippery canvas, burning ropes, a roaming spotlight.
> - Win within a set number of rounds, or just survive. The crowd can be on your side, or against you.
>
> **MAKE**
> - Build on the ring itself: put opponents where they'll stand, set the hero, the ring, the crowd, the rules and the bag.
> - Make your own fighters, moves and items, with your own sprite sheets.
> - Bring your own art: one picture per pose, or a full sprite sheet. The Sprite Studio's **HELP** has the rules and blank templates, and the [creator guide](https://claude.ai/artifact/SerREK4GUZ4vo85WDTnxUJ) has the details.
> - Play-test in one click. You have to beat your battle before you can upload it.
>
> **SHARE**
> - SHARE saves any battle as a small `.chispa.json` file, with your fighters, moves, items and art packed in.
> - Send it to a friend; they IMPORT it (or drop it on the game) and fight it.
>
> **Controls:** mouse, or arrow keys + **Z** (confirm and action commands) + **X** (back). Esc goes back too.
>
> Your battles live in this browser on this device: SHARE the ones you want to keep as a backup.
>
> Early build: the whole built-in cast has its finished art; more fighters, rings and modes are on the way.

| Field | Value |
|---|---|
| Genre | Role Playing |
| Tags | turn-based, wrestling, level-editor, pixel-art, retro, singleplayer, sandbox, 2d |
| AI generation disclosure | itch asks whether the project uses generative AI. The code and the fighter sprites were made with Claude: answer for code and graphics accordingly. |
| Custom noun | battle maker |
| Inputs | Keyboard, Mouse, Touchscreen |
| Accessibility | (leave empty) |
| Languages | English |

Before going public, open the creator guide link's Share menu and make it viewable by anyone with the link, or players won't be able to open it.

## Media

| Field | File |
|---|---|
| Cover image (630 × 500) | `page/cover_630x500.png` |
| Screenshots | `page/screenshot_1_title.png` … `page/screenshot_5_battle_maker.png`, in order |

## Visibility

1. **Draft** first: open the page, press Run game, play a fight, SHARE a battle and IMPORT it back.
2. Then **Public**.

## Updating it later

1. Run `npm run build:itch`.
2. Upload the new zip in place of the old one (Edit game → Uploads).
3. Players' battles stay: they're kept in their browsers.
