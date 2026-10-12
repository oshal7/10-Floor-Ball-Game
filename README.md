# Tilt10

A minimalist physics puzzle. You guide a ball down a 10-floor shaft with **12 balls** for the whole run, and every
ball you lose **stays in the shaft**. Dead balls fill spike pits, hold pressure plates down and add weight to glass.

Inspired by Cursor\*10, where you cooperate with your own earlier attempts. In Tilt10 the earlier attempts stay
behind as physical bodies, not replayed ghosts.

**Play:** https://oshal7.github.io/10-Floor-Ball-Game/ (the start page links to both versions)

| Version | Folder | View | Controls |
| --- | --- | --- | --- |
| **v2** (current) | [`v2/`](v2/) | Top-down: you look down the shaft and dive from board to board | Mouse or finger |
| v1 | [`v1/`](v1/) (also git tag `v1.0`) | Side view of a vertical shaft | Phone tilt (gyroscope) |

## Run locally

No build step. It's static HTML + ES modules.

```bash
npx http-server -p 8080 .      # or: python3 -m http.server 8080
```

Then open `http://localhost:8080`.

GitHub Pages serves the repo root (*Settings → Pages → Deploy from a branch →
`claude/affectionate-albattani-z62ld2` / `(root)`*), and every push redeploys it.

---

## v2: Top-down dive

You look straight down the shaft. Each floor is a square board. Roll the ball into the floor's hole and the camera
dives to the next floor, where the ball lands at the same spot. The floor below is visible through every hole.

### Controls

| Action | Mouse | Phone / tablet | Keyboard |
| --- | --- | --- | --- |
| Steer | The ball rolls toward the cursor | Hold a finger on the screen; the ball rolls toward it | Arrow keys / WASD |
| Give up this ball (its body stays) | Right-click | **⚓ Anchor** button | Space |

The further the cursor is from the ball, the harder it rolls. The board leans slightly toward the cursor to show
the pull. Each ball gets **30 s per floor**. When the time runs out, the ball stops and its body stays where it is.

### How earlier balls change the shaft

| Effect | How it works |
| --- | --- |
| **Bodies** | Anchored or timed-out balls stay where they stopped as obstacles, numbered by attempt. |
| **Paving** | A ball that falls into a spike pit fills it, and later balls roll straight over. |
| **Plates** | A plate is pressed while a ball or body sits on it. Anchor on it to hold its door open for good. |
| **Glass floors** | Every ball that lands on one cracks it, and 3 cracks break it. Two balls on it at once (live or dead) also break it. |
| **Glass walls** | Hit them fast to crack or shatter them. Cracks carry over to later balls. |
| **Bodies fall** | When glass or a tile under a body gives way, the body drops to the floor below and can plug a pit there. |
| **Crumbling tiles** | Tiles fall away 0.55 s after anything touches them and don't come back. Dead balls fill the gaps. |
| **Trails** | Each earlier ball leaves a faint trail of its path. |

A ball hit by a sweeper shatters and leaves nothing behind.

### The floors

| # | Name | Theme | Puzzle |
| --- | --- | --- | --- |
| 1 | First Drop | Introduction | A zig-zag to learn cursor steering |
| 2 | Pits | Introduction | Weave between spike pits |
| 3 | The Fallen | Momentum | A spike pit blocks the only gap, so one ball has to die there to fill it |
| 4 | Glass Floor | Destruction | The exit is under glass: anchor one ball on it, then roll another on top |
| 5 | Sweepers | Impact | Time a rotating arm, then smash a glass wall at speed |
| 6 | Shortcut | Destruction | The landing spot is glass: after three landings it breaks into a shortcut |
| 7 | Pressure | Switches | Anchor a ball on the plate to open the door to the exit |
| 8 | Sequence | Switches | Plate 1 opens the gate to plate 2: two sacrifices, in order |
| 9 | Inversion | Precision | Violet zones invert your steering, and the corridors are lined with pits |
| 10 | The Crumbling Bottom | Chaos | A crumbling bridge over a spike void, with a sweeper crossing it |

### Code map

```
v2/index.html      HUD, overlays, buttons
v2/style.css       UI styling
v2/js/levels.js    All 10 boards as data (walls, holes, pits, glass, plates, doors, sweepers, zones, crumbling grid)
v2/js/game.js      Physics, cursor/touch/keyboard steering, depth-dive rendering, audio
```

To change a floor, edit `FLOOR_DEFS` in `v2/js/levels.js`. Each board is 400×400. The ball lands on the next floor
at the same x/y it fell from, so each floor's `entries` must line up with the holes of the floor above.

Dev URL parameters: `?floor=7` starts every ball at floor 7, and `?balls=20` changes the ball budget.
`window.tilt10` exposes the game state in the console.

---

## v1: Side-view descent

The original prototype. It shows the shaft from the side and steers by tilting the phone (DeviceOrientation, so it
needs HTTPS and motion permission on iOS). It falls back to arrow keys or a drag joystick. The ten floors use
pendulums, glass, plates, a reverse-gravity zone and crumbling tiles. The code is in `v1/`, and the git tag `v1.0`
marks the commit before the restructure.

## Ideas for later

- Cursor\*10-style replay ghosts that repeat earlier balls' paths alongside the live one
- Checkpoints, so later balls can start partway down the shaft
- Daily seed and shared leaderboard (fewest balls)
- Level editor, since floors are plain data
