# SPLASH ONE

A 3D jet combat game for desktop browsers: dogfights against AI pilots, free flight, a training academy,
a nine-mission campaign and survival waves, built with three.js and TypeScript.

The full design spec lives in [`FIGHTER_JET_GAME_PROMPT.md`](FIGHTER_JET_GAME_PROMPT.md).

## Play

You need [Node.js](https://nodejs.org) 20 or newer and a desktop browser with WebGL 2 (Chrome, Edge, Firefox or Safari).

```bash
npm install
npm run dev
```

Open the address it prints (usually `http://localhost:5173`), press any key on the title screen, and pick a mode.
Click the game view once so the mouse can steer (pointer lock). Press **Esc** to pause.

To make a production build: `npm run build`, then serve the `dist/` folder with any static web server.

## Controls

| Action | Keyboard / mouse | Gamepad |
|---|---|---|
| Steer (mouse aim) | Move the mouse | Left stick |
| Pitch / roll (direct) | S / W, A / D | Left stick |
| Yaw | Q / E | LB / RB |
| Throttle up (hold at 100% for afterburner) / down | Shift / X | RT / LT |
| Guns | Left mouse button | X |
| Fire selected weapon | Right mouse button or Space | A |
| Cycle weapon | Tab | D-pad up |
| Lock / cycle target | T | Y |
| Look at target (hold) | C | — |
| Flares / chaff | F / G | B / D-pad down |
| Change camera (chase / cockpit) | V | View |
| Free look (hold) | Middle mouse | Right stick |
| Landing gear / airbrake / flaps | L / B / K | D-pad left / — / D-pad right |
| Wingmen: attack, cover, engage, form up | 1 – 4 | — |
| Toggle HUD / performance overlay | H / F3 | — |
| Pause | Esc or P | Start |

All bindings can be changed in **Settings → Controls**. Keys are bound by physical position, so AZERTY and
QWERTZ keyboards work too.

## Modes

- **Instant Action**: pick a map, your jet, 1 to 12 bandits, up to 7 wingmen, their skill, weapon rules, respawns and limits.
- **Free Flight**: fly any map with a timed ring course and optional target drones. Unlimited fuel.
- **Training**: eight lessons, from basic flight to ground attack, with medals.
- **Sortie (campaign)**: Operation Low Tide, nine missions across the maps.
- **Survival**: endless waves that get bigger and better. One aircraft, repaired between waves.

## Development

| Command | What it does |
|---|---|
| `npm run dev` | Dev server with hot reload |
| `npm run check` | Typecheck, lint, placeholder guard, unit tests and production build |
| `npm run e2e` | Browser tests (Playwright); fail on any console error or warning |
| `npm run bench` | 12-aircraft benchmark with CPU, draw-call and triangle budgets |
| `bash scripts/qa-sweep.sh` | Runs every gate and prints a summary |

Architecture and module ownership: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md). Progress: [`docs/PROGRESS.md`](docs/PROGRESS.md).
