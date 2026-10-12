# Tilt10

A minimalist physics puzzle for the phone. You steer a ball down a 10-floor vertical shaft by tilting the phone.
You get **12 balls** for the whole run, and every ball you lose **stays in the shaft**. A dead ball can fill a
spike pit, hold a pressure plate down, or drive a later ball's impact into cracked glass.

Inspired by Cursor\*10, where you cooperate with your own earlier attempts. In Tilt10 the earlier attempts stay
behind as physical bodies, not replayed ghosts.

## Play

No build step. It's static HTML + ES modules.

```bash
npx http-server -p 8080 .      # or: python3 -m http.server 8080
```

Open `http://localhost:8080` on a desktop to try it with the keyboard.

**On a phone**, motion sensors only work over **HTTPS** (iOS also asks for permission when you tap *Drop the first
ball*). The easiest options:

- **GitHub Pages:** live at **https://oshal7.github.io/10-Floor-Ball-Game/** once Pages is enabled
  (*Settings → Pages → Deploy from a branch → `claude/affectionate-albattani-z62ld2` / `(root)`*). Every push redeploys it.
- **Local tunnel:** run the server above, then `npx localtunnel --port 8080` (or ngrok / cloudflared) and open the HTTPS URL.

### Controls

| Action | Phone | Desktop |
| --- | --- | --- |
| Steer | Tilt the phone | Arrow keys / WASD |
| Give up this ball (its body stays) | **⚓ Anchor** button | Space |
| Set "level" to how you're holding it now | **◎** button | C |
| No sensor fallback | Drag anywhere (virtual joystick) | Mouse drag |

Gravity always keeps some pull downward. Tilting steers left and right, and pulls the ball down harder or softer.
You can't roll uphill, so a ball in a dead end is stuck and has to be anchored. Each ball gets **30 s per floor**.
When the time runs out, the ball goes still and its body stays where it is.

## How earlier balls change the shaft

| Effect | How it happens |
| --- | --- |
| **Bodies are obstacles** | Anchored, timed-out and impaled balls become solid bodies, numbered by attempt. |
| **Paving** | A ball that dies on spikes stays impaled, and later balls roll over it. |
| **Plates** | A pressure plate is pressed while any ball or body rests on it. Anchor on it to hold its door open for good. |
| **Glass remembers** | Each hit cracks the glass, and the cracks carry over to later balls. Landing on a body that rests on glass drives the blow into the glass. |
| **Bodies fall** | When glass, a tile or a door under a body goes away, the body drops, and it can land on something lower down, like a plate. |
| **Crumbling tiles** | Tiles fall apart 0.3 s after anything touches them, and they don't come back. |
| **Trails** | Each earlier ball leaves a faint trail of its path. |

A ball crushed by a pendulum shatters and leaves nothing behind.

## The floors

| # | Name | Theme | What it teaches |
| --- | --- | --- | --- |
| 1 | First Drop | Introduction | Tilt feel: a zig-zag of ledges |
| 2 | Funnels | Introduction | Angled walls and a deflector block |
| 3 | The Fallen | Momentum | A spike pit: jump it with speed, or let a dead ball fill it |
| 4 | Glass Floor | Destruction | A glass floor that only a hard fall breaks (tilt forward to slam) |
| 5 | Pendulum Hall | Impact | Time two pendulums and break a glass wall with sideways speed |
| 6 | Two Panes | Destruction | Break two panes in one fall, with a pendulum swinging through the shaft |
| 7 | Pressure | Switches | Anchor a ball on a plate to open the trapdoor |
| 8 | Sequence | Switches | Plate 1 opens a gate that leads to plate 2: two sacrifices, in order |
| 9 | Inversion | Precision | A reverse-gravity zone lifts you through a narrow slot over a wall |
| 10 | The Crumbling Bottom | Chaos | A crumbling bridge over spikes, guarded by a pendulum |

## Code map

```
index.html      HUD, overlays, buttons
style.css       UI styling
js/levels.js    All 10 floors as data (walls, glass, spikes, tiles, plates, doors, pendulums, zones)
js/game.js      Physics, input (DeviceOrientation, keys, drag), rendering, audio/haptics
```

To change or add a floor, edit `FLOOR_DEFS` in `js/levels.js`. Each floor is 360×640 in its own coordinates, and
the bottom 20 px is the slab the ball has to get through.

Dev URL parameters: `?floor=7` starts every ball at floor 7, and `?balls=20` changes the ball budget.
`window.tilt10` exposes the game state in the console.

## Ideas for later

- Real Cursor\*10-style replay ghosts that repeat earlier balls' inputs alongside the live one
- Daily seed and shared leaderboard (fewest balls)
- Level editor, since floors are plain data
- More persistence: balls that rust into hinges, bodies that ignite fuses, magnets
