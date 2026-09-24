# SPLASH ONE: Master Build Prompt for Claude Code

> **How to use this file**
>
> 1. Create an empty folder or repo for the game and put this file in it.
> 2. Open Claude Code in that folder.
> 3. Send this message:
>    **`Read FIGHTER_JET_GAME_PROMPT.md from top to bottom, then build the game it describes. Start with Phase 0 and keep going phase by phase until the Definition of Done is met.`**
> 4. If a session ends partway through the build, open a new one and send:
>    **`Resume the build. Read CLAUDE.md and docs/PROGRESS.md first, then continue from the next open task.`**
>
> Everything below the line is the prompt.

---

## 0. Mission

You are the lead engineer, technical artist and game designer on **SPLASH ONE** (working title), a complete 3D jet combat game that runs in desktop browsers. It includes dogfights against AI pilots, several maps, several jets, a full weapons suite, free flight, a training academy, a campaign and a polished user interface.

**The quality bar:** a player should believe a small professional studio made it. Nothing should look like a tech demo, a tutorial project or AI output. It runs at a locked 60 FPS or better, with no stutter and no flicker.

**Feel references** (for feel only; never copy their assets, UI layouts or names):

- *Ace Combat 7*: easy to pick up, dramatic, readable.
- *War Thunder*: aircraft feel heavy, and energy matters.
- *Project Wingman*: a clean HUD and restrained UI.

You have full autonomy. Work until the **Definition of Done (§14)** is met. Do not stop at a prototype. Do not ask for confirmation between phases. Ask the human only when a decision truly cannot be made from this document. When you do ask, state the decision, give your recommended default and carry on with that default while you wait.

---

## 1. Non-negotiables

1. **60 FPS minimum, not a cap.** On the reference hardware (§10) the game holds 60 FPS at the default preset, with the 1% low at 55 FPS or higher. It never stutters, hitches on first use of an effect, or pauses for garbage collection.
2. **Zero flicker.** There is no z-fighting, shadow acne, shimmering, LOD popping, alpha-sorting flicker, HUD flicker or white or black flashes. See §11 part B.
3. **Zero console noise.** There are no errors, warnings, unhandled promise rejections, failed requests or WebGL warnings, ever. Automated tests fail if any appear.
4. **No placeholders.** Remove every TODO, stub, "Coming soon", lorem ipsum, gray box, default material, `undefined` and `NaN` before a phase is closed.
5. **Everything visible works.** Every button, setting, mode and key binding shown to the player is fully implemented. If something can't be finished, it doesn't appear in the UI.
6. **Handmade look and feel.** Follow the art direction (§6, §7), the UI design system (§8) and the anti-AI-look rules (§9).
7. **Frame-rate-independent simulation.** Use a fixed timestep with interpolation. The game plays the same at 30, 60, 144 and 240 Hz.
8. **Original work only.** Aircraft, nations, squadrons, logos and names are all fictional. Do not use real military insignia, trademarks or real aircraft names.
9. **Self-contained.** After `npm install` the game runs offline. Nothing loads from a CDN at runtime and no API keys are needed. Every asset is either generated procedurally or bundled in the repo with its license recorded.
10. **Report truthfully.** Never claim something works until the verification gates (§2.5) have proved it. If something is broken, say so in `docs/PROGRESS.md`.

---

## 2. Dynamic workflow

You will not build this in one pass. Work in a **closed loop**: plan, build, verify, critique and re-plan, using task tracking, persistent memory files, parallel subagents and automated gates. This workflow is required.

### 2.1 The operating loop (run it for every phase and every task)

```
        ┌───────────────────────────── RE-PLAN ◄──────────────────────────────┐
        ▼                                                                      │
   ORIENT ──► PLAN ──► BUILD ──► VERIFY ──fail──► DIAGNOSE ──► FIX ──► VERIFY  │
                                   │ pass                                      │
                                   ▼                                           │
                           CRITIQUE (screenshots + reviewer subagent)          │
                                   │ defects? ──yes──► FIX ──► VERIFY          │
                                   ▼ no                                        │
                    COMMIT ──► UPDATE docs/PROGRESS.md ──► NEXT TASK ──────────┘
```

- **ORIENT:** Read `CLAUDE.md`, `docs/PROGRESS.md` and the spec sections for the task. Check the current state of the code. Don't assume you remember it.
- **PLAN:** Break the work into tasks of roughly 30 to 90 minutes each, each with measurable acceptance criteria, and put them in the task list.
- **BUILD:** Make small, coherent changes. Keep modules focused and under about 400 lines.
- **VERIFY:** Run the gates (§2.5). If anything is red, fixing it is the only priority.
- **DIAGNOSE:** Find the root cause. Reproduce the bug with a test before you fix it.
- **CRITIQUE:** Look at screenshots yourself (§2.6). At the end of a phase, spawn a fresh-context reviewer subagent (§2.4).
- **COMMIT:** Commit only when everything is green. Update `docs/PROGRESS.md` every time.
- **RE-PLAN:** Use what you learned (performance numbers, bugs, risks) to reorder or add tasks.

### 2.2 Persistent memory that survives context limits

Create these files in Phase 0 and keep them current. They are your memory across sessions and context compaction.

| File | Purpose |
|---|---|
| `CLAUDE.md` | Short working rules: gate commands, the "never" list, architecture map, units and conventions. Keep it under 120 lines. |
| `docs/PLAN.md` | Phases, task graph, dependencies and the risk register (top risks with mitigations). |
| `docs/PROGRESS.md` | What's done, what's in progress, what's next, known issues and the latest performance numbers. Update it after every task. |
| `docs/ARCHITECTURE.md` | Module map, frozen interfaces, data flow and system update order. |
| `docs/DECISIONS.md` | One entry per decision: context, choice, alternatives and why. Record dependency versions here. |
| `docs/QA_REPORT.md` | Every Zero-Defect item (§11) with its status and how it was verified (test name, screenshot or manual check). |

Starter `CLAUDE.md` (adapt as the project grows):

```md
# SPLASH ONE: working rules
- Spec (source of truth): FIGHTER_JET_GAME_PROMPT.md. Progress: docs/PROGRESS.md.
- Before every commit: `npm run check && npm run e2e`. Also run `npm run bench` for anything that can affect performance.
- Never: skip or weaken tests, use @ts-ignore or blanket eslint-disable, leave TODOs or placeholders,
  bind Ctrl/Meta combos, allocate in per-frame code, or use Math.random in gameplay (use the seeded RNG).
- Frame order: input -> sim (fixed 120 Hz) -> interpolate -> camera -> audio -> HUD -> render.
- Units: SI internally (m, m/s, kg, N, rad). 1 world unit = 1 m. Convert only for display.
- Tuning values live in src/data/**, never inline.
- Architecture map: see docs/ARCHITECTURE.md
```

On resume, always read `CLAUDE.md` and `docs/PROGRESS.md` before anything else.

### 2.3 Task tracking

- Use Claude Code's task list tool to mirror `docs/PLAN.md`. Keep exactly one task `in_progress` at a time.
- Mark a task done only after its gate passes. Don't mark it done because the code is written.
- When you discover new work (bugs, missing pieces, polish), add it as a task **immediately**. Don't rely on remembering it.
- Use **Plan mode** for Phase 0 and before any change that touches more than about 5 files or a frozen interface.

### 2.4 Subagents: fan out and fan in

Use subagents where they help. Don't use them for tightly coupled work.

**When to fan out:** once Phase 1 has frozen the core interfaces, independent workstreams can run in parallel. That means terrain and maps, aircraft models, UI and menus, audio, and training or campaign content. Keep flight model, camera and HUD core serial, because they are tightly coupled.

**Rules for parallel workers:**

- Each worker owns an **exclusive set of paths**. No two workers edit the same file.
- Use isolated git worktrees for workers when available.
- Each worker runs the gate on a **unique port** (`PORT=51xx`) so parallel test runs don't collide.
- A worker that needs a change to a shared interface stops and reports the exact proposal. It must not make the change itself.
- You are the orchestrator. Review each worker's diff, merge the work one stream at a time, run the **full** gate after each merge and fix any integration issues before merging the next.

**Worker brief template** (send it filled in, word for word):

```
ROLE: <workstream> engineer on SPLASH ONE.
READ FIRST: CLAUDE.md, docs/ARCHITECTURE.md, and spec sections <§…>.
YOU OWN (exclusive write): <paths>
READ-ONLY: <paths>
DELIVER: <concrete list>
ACCEPTANCE: <measurable criteria, including perf budget and screenshot review>
GATE: PORT=<unique> npm run check && PORT=<unique> npm run e2e -- <filter>  (must be green)
RULES: Follow §1 and §11 of the spec. Do not edit outside owned paths. If you need an interface change, stop and report the exact proposal.
REPORT BACK: summary, files changed, gate output, screenshot paths, known risks.
```

**Reviewer brief template.** Use it at the end of every phase, always with a fresh context:

```
ROLE: Hostile QA lead. You did not write this code and you don't trust it.
SCOPE: git diff <phase-start>..HEAD (plus any paths listed).
CHECK AGAINST: spec §1 (non-negotiables), §10 (perf budgets), §11 Zero-Defect categories <…>, §8/§9 for UI.
METHOD: read the code, run all gates, drive the game with Playwright, capture and inspect screenshots,
        and try to break it: input spam, pause spam, rapid restarts, resizes, tab hide/show, focus loss.
REPORT: only confirmed defects: ZD-ID, severity, file:line, repro steps, suggested fix.
```

**Research subagents:** if you're unsure about a library API, spawn an exploration agent to read the installed package's source or type definitions in `node_modules`. Never guess an API from memory. Library APIs change between versions.

In Phase 8, run several reviewers in parallel, one per group of §11 categories.

### 2.5 Verification gates

Create these npm scripts in Phase 0 and make them **fast and strict**:

| Script | What it does |
|---|---|
| `npm run typecheck` | `tsc --noEmit` with strict settings |
| `npm run lint` | ESLint and Prettier check, zero warnings allowed (`--max-warnings 0`) |
| `npm run test` | Vitest unit tests |
| `npm run build` | Production build; fails on warnings you haven't justified |
| `npm run guard` | Script that fails the build on `TODO`, `FIXME`, `lorem`, `console.log`, `@ts-ignore`, `debugger` or `Math.random(` outside `src/core/rng.ts` in `src/` |
| `npm run check` | typecheck + lint + guard + test + build |
| `npm run e2e` | Playwright smoke and flow tests (§12). Fails on any console error or warning, page error or failed request |
| `npm run bench` | Performance benchmark (§10.4). Fails when a budget is exceeded |

A phase is closed only when `check`, `e2e` and `bench` are all green, the visual critique passes and the reviewer's findings are fixed. **Never** weaken a test, raise a threshold, or skip or quarantine a test to get green. Fix the cause.

Headless WebGL: Chromium in a container may need `--use-angle=swiftshader --enable-unsafe-swiftshader` (or `--use-gl=swiftshader` on older builds). If a Chromium binary is already installed, use it rather than downloading one. Software rendering makes GPU FPS meaningless in CI, so enforce **CPU frame time, draw calls, triangles and heap** there, and validate real FPS with the in-game benchmark (§10.4).

Optional: if Claude Code hooks are available, add a hook that runs `npm run typecheck` after edits to `.ts` files, so errors show up immediately.

### 2.6 Visual verification loop

After any visual change:

1. Capture screenshots with Playwright at **1920×1080**. For UI work, also capture **1280×720, 2560×1080 (21:9) and 1024×768 (4:3)**. Save them to `artifacts/screens/`, which is gitignored.
2. **Open and look at them yourself.** Critique them against §6 to §9. Write down concrete defects, such as "horizon fog is bluer than the sky at the horizon" or "menu labels have 3 different letter-spacings".
3. Fix and recapture. Do at least **2 critique passes** per phase that changes visuals. Keep going until you'd put the screenshot on a store page.

Use fixed seeds, fixed time of day and fixed camera paths (via the debug API, §4.5) so screenshots are reproducible and comparable.

### 2.7 Adaptive re-planning rules

- **Performance first.** If `bench` fails, the performance fix goes ahead of all feature work.
- **Two strikes.** If a bug survives two fix attempts, stop patching. List your hypotheses, add instrumentation, write a failing test, then fix the root cause. Record it in `DECISIONS.md`.
- **Budget pressure.** If a feature threatens the frame budget, build a version that scales with the quality preset. Don't cut quality everywhere.
- **API mismatch.** If the installed library differs from what you expect, read its source. Don't guess.
- **Scope pressure.** Finish and polish the current tier (§5.1) before starting the next. The UI must never expose half-built features. The goal is still **all** tiers: tiers set the order, not what's optional.
- **Surprises.** When something unexpected happens, such as a new risk or a design conflict, update `docs/PLAN.md` and the task list right away.

### 2.8 Git discipline

- Commit at each green gate, using small, logical Conventional Commits (`feat(flight): …`, `fix(hud): …`, `perf(terrain): …`).
- Never commit a failing build. Push at the end of every phase.
- `.gitignore` covers `node_modules`, `dist`, `artifacts`, `test-results`, `playwright-report` and `.env*`.

---

## 3. Tech stack

Use the **latest stable** versions at build time and record them in `DECISIONS.md`. Justify every dependency. Keep the list short.

| Area | Choice |
|---|---|
| Language | TypeScript, `strict: true`, `noUncheckedIndexedAccess`, `noImplicitOverride` |
| Build and dev server | Vite |
| 3D | three.js with `WebGLRenderer` (WebGL2). Choose WebGL2 for consistency across browsers |
| Post-processing | `postprocessing` (pmndrs). It merges effects into fewer passes and is faster than chaining passes |
| Menus | Preact with plain CSS and design tokens (CSS custom properties). No UI kits, no Tailwind default look |
| HUD | One Canvas 2D overlay at device pixel ratio, redrawn once per frame |
| Audio | Web Audio API: procedural synthesis plus optional sample overrides from `public/audio/` |
| Physics | Custom flight model, swept collision tests and a spatial hash. No generic physics engine |
| Terrain generation | Web Workers with transferable buffers |
| Noise and RNG | Seeded PRNG (`src/core/rng.ts`) plus simplex noise (small library or your own implementation) |
| Fonts | Self-hosted with `@fontsource` (OFL licensed). See §8.3 |
| Tests | Vitest for unit tests, Playwright for e2e and bench |
| Lint and format | ESLint (typescript-eslint) and Prettier |

Target browsers: current Chrome, Edge, Firefox and Safari on desktop. Chromium is the primary automated target. Use Playwright Firefox and WebKit too if they're available.

---

## 4. Architecture

### 4.1 Source layout

```
src/
  main.ts                 bootstrap, capability checks, error handlers
  core/                   loop, time, rng, events (typed bus), pool, math (safe helpers, scratch vectors),
                          state machine, settings store, save system, debug API
  input/                  keyboard/mouse/gamepad devices, action map, rebinding, input contexts
  render/                 renderer setup, color management, post-processing, shader warmup,
                          quality presets, adaptive resolution, perf overlay
  world/                  terrain (quadtree/CDLOD, worker gen), water, sky/atmosphere, clouds,
                          vegetation, structures, runways, weather, lighting/time of day
  flight/                 flight model, control laws, assists, autopilot/instructor
  aircraft/               aircraft entity, damage model, systems (fuel, gear, flaps, countermeasures)
  art/aircraft/           procedural jet mesh generators, LODs, liveries, animated control surfaces
  weapons/                guns/ballistics, missiles/guidance, bombs/rockets, targeting, lock-on, RWR
  ai/                     perception, decision (utility AI), maneuvers, pilot control, skill profiles
  fx/                     particles (GPU/instanced), trails/ribbons, explosions, sprite atlas baker, decals
  camera/                 rigs: chase, cockpit, free look, target lock, missile cam, kill cam, photo mode
  audio/                  engine, mixer buses, spatial voices, synth patches, radio/callouts
  modes/                  free-flight, training, instant-action, campaign, survival, mission scripting
  ui/                     Preact screens, components, design tokens, transitions, focus management
  hud/                    HUD canvas renderer and all HUD instruments
  data/                   aircraft, weapons, maps, lessons, missions, AI skills, quality presets (typed)
tests/                    unit tests next to modules or here; e2e/ and bench/ for Playwright
```

### 4.2 Game loop: fixed timestep with interpolation

```ts
const SIM_HZ = 120;
const STEP = 1 / SIM_HZ;
const MAX_FRAME_DT = 0.1;   // clamp after tab switches or hitches
const MAX_STEPS = 8;        // prevent the spiral of death

let acc = 0;
let last = performance.now();

renderer.setAnimationLoop((now: number) => {
  let dt = Math.min((now - last) / 1000, MAX_FRAME_DT);
  last = now;
  if (game.paused) dt = 0;

  input.poll();                                     // gamepads, edge detection
  acc += dt * game.timeScale;
  let steps = 0;
  while (acc >= STEP && steps < MAX_STEPS) {
    sim.step(STEP);                                 // flight, weapons, AI control, collisions
    acc -= STEP;
    steps++;
  }
  if (steps === MAX_STEPS) acc = 0;                 // drop backlog, never try to catch up forever

  const alpha = acc / STEP;
  world.interpolate(alpha);                         // lerp/slerp previous -> current transforms
  cameraRig.update(dt, alpha);                      // AFTER interpolation, or the camera jitters
  audio.update(dt);
  hud.draw();
  post.render(dt);
});
```

- AI **decisions** run at 10 Hz, spread across frames (each agent on a different frame). AI **control** (stick inputs) runs every sim step.
- All smoothing uses frame-rate-independent damping, `x += (target - x) * (1 - Math.exp(-k * dt))`, never a fixed lerp factor.

### 4.3 Game state machine

`Boot → Title ("press any key", which unlocks audio) → MainMenu → (Hangar | Settings | ModeSetup → Briefing) → Loading → InGame {Playing | Paused | Cutscene/KillCam} → Debrief → MainMenu`

Each state has `enter()` and `exit()`. `exit()` must dispose everything it created: meshes, materials, textures, render targets, audio nodes, listeners, workers and timers. The test in §12 (five restart cycles return to baseline memory) enforces this.

### 4.4 Data-driven content

Aircraft, weapons, maps, lessons, missions, AI skills and quality presets are **typed data** in `src/data/`, so tuning never requires code changes. Example of the expected shape:

```ts
export const KESTREL: AircraftDef = {
  id: 'kestrel',
  name: 'T/F-9 Kestrel',
  role: 'Lightweight trainer-fighter',
  massEmpty: 6_800, fuelMax: 2_400,                // kg
  wingArea: 27.9, wingSpan: 9.4,                   // m², m
  thrustDry: 48_000, thrustAB: 76_000,             // N (sea level)
  clAlpha: 4.6, clMax: 1.45, alphaStall: 0.30,     // 1/rad, -, rad
  cd0: 0.021, oswald: 0.82, waveDragMach: 0.92,    // transonic drag rise starts here
  gLimit: { pos: 8.0, neg: -3.0 },
  rates: { roll: 3.9, pitch: 0.55, yaw: 0.18 },    // rad/s at corner speed
  cornerSpeed: 180,                                 // m/s
  hardpoints: [/* station id, position, allowed weapon classes */],
  gun: 'cannon25',
  radar: { rangeM: 22_000, fovDeg: 60 },
  rcs: 1.0,                                         // relative radar signature
  hp: { total: 140, engine: 40, wingL: 35, wingR: 35, tail: 30, cockpit: 25 },
};
```

### 4.5 Debug and test API (development and test builds only)

Expose `window.__SPLASH__` only when `import.meta.env.DEV || import.meta.env.MODE === 'test'`, so it is tree-shaken out of production. It provides:

- `state()`: current screen, mode, map, entity counts, paused flag.
- `perf()`: rolling frame stats (avg, p95, max CPU ms), draw calls, triangles, `renderer.info.memory`, JS heap where available.
- `start({ mode, map, aircraft, seed, timeOfDay, weather, enemies, allies, skill })`: jump straight into a mission.
- `autopilot(routeId | 'dogfight-ai')`: scripted flight for tests and bench runs.
- `camera(presetId)`: fixed camera shots for reproducible screenshots.
- `timeScale(n)` and `step(n)`: deterministic stepping for tests.

URL parameters mirror this for Playwright, for example `?autostart=dogfight&map=kessel&seed=42&camera=hero`.

---

## 5. Game design

### 5.1 Modes and tiers

| Mode | Description | Tier |
|---|---|---|
| **Free Flight** | Any unlocked map, jet, time of day and weather. No enemies. Optional ring courses and target drones. Takeoff from a runway or an air start. | 1 |
| **Training Academy** | 8 lessons with instructor prompts, checkpoints, pass/fail and bronze, silver and gold medals (§5.8). | 1 (lessons 1, 2, 4, 5, 6, 7) / 2 (lessons 3, 8) |
| **Instant Action (Dogfight)** | Configurable: map, time and weather, 1 to 12 enemies, 0 to 7 allies, AI skill, weapons rules (guns only, standard, unlimited), respawns, score limit or time limit. Free-for-all or team. | 1 |
| **Campaign** | 9 scripted missions with briefings, objectives, wingmen and a debrief (§5.9). | 2 |
| **Survival** | Endless escalating waves, with local high scores. | 2 |
| **Photo Mode** | Pause, free camera, hide HUD, depth-of-field, exposure and filters, save PNG. | 2 |
| **Benchmark** | 60-second scripted flythrough that reports avg FPS, 1% low and p95 frame time (§10.4). | 1 |
| Carrier operations, replays and kill-cam replays | Stretch goals once everything else is done. | 3 |

### 5.2 Aircraft roster (fictional)

| Jet | Role | Character | Top speed | T/W (AB, 50% fuel) | G limit | Hardpoints | Gun | Tier |
|---|---|---|---|---|---|---|---|---|
| **T/F-9 Kestrel** | Light trainer-fighter, single engine | Forgiving and agile at low speed; the starter jet | Mach 1.3 | 0.95 | +8 | 4 | 25 mm | 1 |
| **F-24 Harrow** | Air superiority, twin engine, twin tails | Big thrust, strong energy fighter, long radar | Mach 2.3 | 1.15 | +9 | 8 | 25 mm | 1 |
| **MR-31 Wyvern** | Canard-delta multirole | Best instantaneous turn; bleeds energy fast | Mach 1.9 | 1.10 | +9 | 8 | 30 mm | 1 |
| **Kv-40 Borzoi** | Heavy interceptor | Very fast, long-range missiles, poor sustained turn | Mach 2.5 | 1.05 | +7 | 6 | 30 mm | 2 |
| **GA-6 Mule** | Subsonic ground attack | Armored, slow, heavy payload, flares galore | Mach 0.8 | 0.55 | +6 | 11 | 30 mm (heavy) | 2 |
| **X-50 Nightjar** | 5th-gen stealth, internal bays | Low radar signature (enemy lock range −40%); unlocked late | Mach 2.0 | 1.20 | +9 | 4 internal + 4 external | 25 mm | 2 |

Both factions can fly every jet, with different liveries. Tune the flight model until each jet's measured top speed, climb rate and sustained turn rate match its stats within ±5%. Unit tests enforce this.

### 5.3 Weapons

Ranges are compressed about 50% from real life so fights stay visual. The compression factor is a single setting in the data files.

| Weapon | Key parameters | Counter |
|---|---|---|
| **25 mm rotary cannon** | 60 rounds/s, 1,050 m/s, 510 rounds, tracer every 4th round, 1.5 mrad dispersion, 9 damage per hit, 2.0 s lifetime | Jinking, range |
| **30 mm revolver cannon** | 28 rounds/s, 900 m/s, 180 rounds, 22 damage per hit | Same |
| **SRM** (short-range IR, "Fox Two") | 0.3–5 km, seeker gimbal ±45°, lock in 1.0 s, 35 G, 2.5 s motor then coasts with drag, 8 m proximity fuse, lifetime 14 s. Best from the rear hemisphere | Flares (timing and aspect matter), hard break, sun |
| **MRM** (active radar, "Fox Three") | 1.5–20 km, 2.0 s lock, datalink midcourse until "pitbull" at 8 km, 30 G, 12 m proximity fuse, lifetime 40 s | Chaff, beaming or notching (±12° of 90° aspect), cranking, terrain masking |
| **LRAAM** (special, Harrow and Borzoi) | 5–35 km, 4 per sortie | Same as MRM |
| **Multi-lock SRM** (special, Wyvern) | Locks up to 4 targets and fires a salvo | Flares |
| **Rocket pod** | 19 unguided rockets, 700 m/s, 45 damage, 8 m splash, CCIP pipper | None; skill-based |
| **Laser-guided bomb** | 500 kg, guided to the designated point, 30 m splash | Point defense and SAMs |
| **Air-to-ground missile** | TV-guided, 8 km, for SAMs and ships | CIWS on ships |
| **Countermeasures** | 60 flares and 60 chaff, salvo of 2, 0.25 s cooldown, auto-release option | n/a |

- **Guidance:** proportional navigation (N = 3 to 4) with G limits, seeker gimbal limits, line-of-sight checks against terrain, and a decoy model that depends on aspect, timing and seeker resistance.
- **Missile lifecycle:** safe-arm time (0.4 s), owner exclusion, maximum lifetime, and self-destruct when closing speed stays negative for 1.5 s.
- **Guns:** each bullet is a pooled, instanced tracer. Hits are tested with swept segment-vs-capsule checks every sim step (no tunneling). The HUD shows a lead-computing gunsight (funnel plus lead pip).

### 5.4 Flight model

A "semi-sim" model: physically grounded, but tuned for fun.

- **Forces:** thrust (spool time 1.5 s dry, 0.6 s to afterburner), lift `L = q·S·CL(α)` where `q = ½ρv²`, drag `D = q·S·(CD0·waveDrag(M) + k·CL²)` with `k = 1/(π·e·AR)`, and gravity.
- **Atmosphere:** ISA density and speed of sound vary with altitude. Thrust lapses with altitude. There is a transonic drag rise.
- **Stall:** past `alphaStall`, lift drops off. Buffet, a stall warning and wing drop follow, and recovery requires unloading. Sim mode allows spins. Standard mode auto-recovers gently.
- **Control authority** scales with dynamic pressure, so controls feel mushy at low speed and crisp at corner speed. A G limiter and an AoA limiter are on in Standard mode and can be turned off in Sim mode.
- **Energy:** turning bleeds speed. Show sustained versus instantaneous turn performance on the HUD energy cue.
- **Assists:** auto-coordination (turns stay coordinated automatically), auto-trim and optional auto-level. In Standard mode the rudder is assisted.
- **Control schemes:**
  1. **Mouse Aim (default):** the mouse moves an aim reticle in the world, and an instructor PID controller flies the jet toward it using the real flight model.
  2. **Direct:** keyboard or joystick axes drive the control surfaces.
  3. **Gamepad:** tuned response curves.
- **Ground handling:** landing gear with suspension, nosewheel steering, wheel brakes, flaps, airbrake and a ground-effect cushion. Landing gear-up or too hard causes damage. Gear speed limits apply.
- Orientation uses **quaternions only**. Normalize after every integration step.

### 5.5 Damage model

- Components: engine, left wing, right wing, tail and cockpit. Each has HP and **gameplay effects**. Engine damage cuts thrust and makes smoke, then fire. Wing damage causes a roll bias and less lift. Tail damage reduces yaw and pitch authority.
- **Visual damage:** smoke trails, fire, sparks on hits, bullet-hole decals on the player's jet in cockpit view, and parts that break off (wingtip or tail) at 0 HP.
- **Death:** a fireball, a tumbling wreck with debris and smoke, ejection (a pilot chute you can see), then a camera cut to the kill cam or respawn.
- Hit feedback is subtle but clear: a hit marker, a sound and an impact flash on the target.

### 5.6 AI pilots

Build the AI as three layers. The AI uses **the same flight model, weapons and sensor rules as the player**, with no cheating physics.

1. **Perception** (10 Hz): radar cone and range, visual range, line of sight through terrain, RWR, and memory of last known positions. It can lose track of targets.
2. **Decision:** a utility AI that scores these goals: Patrol, Intercept, Attack-Guns, Attack-IR, Attack-Radar, Defend-Missile, Defend-Guns, Extend/Separate, Reposition-Vertical, Rejoin-Wingman, Avoid-Terrain (hard override), Return-to-Area. Add hysteresis so it doesn't flip-flop between goals.
3. **Maneuver and control:** a library of maneuvers (lead, lag and pure pursuit, high and low yo-yo, break turn, barrel roll defense, split-S, Immelmann, scissors, beam or notch, crank, extend and pull, terrain masking) that output a desired direction and throttle. A damped, rate-limited PID "virtual stick" then flies it through the real flight model.

| Parameter | Rookie | Veteran | Ace |
|---|---|---|---|
| Reaction time | 0.9 s | 0.45 s | 0.2 s |
| Gun aim error | 18 mrad | 8 mrad | 3 mrad |
| G used | ≤ 6 | ≤ 7.5 | ≤ 9 (with G-LOC risk) |
| Flare timing | Late or random | Good | Near optimal |
| Awareness | Visual 3 km | Visual 6 km plus radar | Visual 10 km plus radar plus RWR |
| Energy tactics | None | Some | Full (yo-yos, extensions, vertical fight) |
| Missile discipline | Fires out of the launch envelope | Fires in envelope | Fires inside the no-escape zone |

- **Fairness:** at most 1 (Rookie), 2 (Veteran) or 3 (Ace) AI attack the player at the same time. Attacks are telegraphed with RWR "spike" tones and radio calls. The AI never uses rubber-banding or perfect aim.
- **Safety:** a terrain look-ahead probe checks 3 to 5 seconds ahead and forces a pull-up override. A deconfliction bubble prevents AI mid-air collisions. A stalemate detector notices endless circling (more than 30 s with no gain) and switches tactics.
- **Personality:** each pilot has seeded aggression, preferred tactics and a callsign, so pilots don't behave identically.
- **Wingmen** (Tier 2) take commands: *Attack my target*, *Cover me*, *Engage at will*, *Form up*.
- **Debug view** (F4, dev only): draws each AI's intent, target line, chosen goal and utility scores.

### 5.7 Maps

Each map is **40 × 40 km** of playable area, with visual terrain or ocean continuing to the horizon so there is never a visible edge. Every map is fully deterministic from its seed plus hand-authored control data: runway flattening, canyon splines, coastlines and points of interest.

| # | Map | Biome | Time and weather | Signature features | Tier |
|---|---|---|---|---|---|
| 1 | **Kessel Strait** | Temperate coast and islands | 15:00, fair, scattered cumulus | Airbase with 2 runways, cliffs and lighthouse, harbor town, naval group | 1 |
| 2 | **Mesa Roja** | Red desert canyons | 18:40 golden hour, dust haze | 11 km winding canyon (the canyon run), dry-lakebed airbase, radar dishes | 1 |
| 3 | **Norrdal Fjords** | Alpine glaciers and fjords | 10:00, overcast deck at 1,800 m with sun above it | Steep fjords, dam, ski town, snow and ice, flying above and below the clouds | 1 |
| 4 | **Port Varen** | Coastal city at night | 23:00, moonlit, light haze | City light grid (instanced emissive windows), bridges, SAM belt, flak, searchlights | 2 |
| 5 | **Typhoon Line** | Open ocean storm | Dusk, heavy rain, lightning | Carrier group, towering storm cells with turbulence, lightning (respects reduce-flashes) | 2 |

Out of bounds: show a "RETURN TO COMBAT AREA" warning with a 10 s countdown and an audio cue. In Free Flight an assist turns you back instead of destroying the jet.

### 5.8 Training Academy

Each lesson has short instructor text prompts (written in pilot brevity), checkpoints, the ability to retry from a checkpoint, a clear pass condition, medal thresholds and a skip or exit option at any time.

1. **Basic Flight:** pitch, roll and yaw; fly through a ring course.
2. **Energy and Throttle:** afterburner, speed management, stall and recovery.
3. **Takeoff and Landing:** runway takeoff, circuit, approach with a glide slope indicator, touchdown and braking.
4. **Gunnery:** towed target and slow drones; using the lead pip.
5. **Missiles:** IR lock and launch, radar lock beyond visual range.
6. **Defensive Flying:** beat incoming missiles with flares, chaff, break turns and beaming.
7. **Basic Fighter Maneuvers:** 1v1 against a Rookie AI from offensive, neutral and defensive setups.
8. **Ground Attack:** rockets with CCIP, laser-guided bombs, SAM avoidance.

### 5.9 Campaign: "Operation Low Tide"

The story is a fictional conflict: Allied Coastal Command against the Varen Republic. Briefings are short and have a documentary tone. Missions are data-driven scripts built from triggers, objectives, waves, events and radio lines.

1. **First Light** (Kessel Strait): combat air patrol; two Rookie waves.
2. **Tanker Track** (Kessel Strait): defend the tanker from Borzoi interceptors.
3. **Canyon Run** (Mesa Roja): stay under 150 m through the canyon to destroy radar sites.
4. **Dust Line** (Mesa Roja): escort a strike package against fighters.
5. **Cold Water** (Norrdal Fjords): take down the dam's SAM network under the cloud deck.
6. **Above the Deck** (Norrdal Fjords): fight a Veteran squadron above and below the cloud layer.
7. **Lights Out** (Port Varen): night strike through the SAM belt and flak.
8. **Typhoon** (Typhoon Line): defend the carrier against an anti-ship strike in the storm.
9. **Splash One** (Kessel Strait, dawn): duel the enemy ace squadron, four Aces.

Example briefing tone:

> *"Four Borzoi interceptors crossed the Kessel median line at 0612, heading for the tanker track. Intercept and prevent them from reaching it. Weapons are free once hostile intent is confirmed. Tanker call sign is SHEPHERD. Bingo fuel is 1,200 kg."*

### 5.10 Progression

- Earn XP and credits from missions, lessons and dogfights. Pilot rank goes from 1 to 30, and ranks unlock jets, weapons, liveries and callsign plates. Track medals and service records (kills by weapon, accuracy, sorties, hours flown).
- **Saves** go in `localStorage` with a versioned schema, validation, migrations, a backup slot and an in-memory fallback (see §11 part K).

### 5.11 Cameras

- **Chase:** a spring-damped follow camera with lag in position and roll, a subtle FOV boost at high speed (at most +6°) and terrain collision.
- **Cockpit:** interior with canopy frame, instrument panel with live MFD canvases (radar and damage), a moving stick and throttle, and the HUD glass projected at infinity (collimated). Tier 1 is a simplified cockpit; Tier 2 is fully detailed.
- **Free look** (mouse or right stick, snaps back), **target lock camera** (padlock, keeps the target and your jet framed), **missile camera** (optional) and a **kill cam** (0.3× slow motion for 0.8 s, skippable, can be turned off).
- **Camera shake** is trauma-based and uses smooth noise, never per-frame random values. Players can scale it from 0 to 100%.
- Camera switches blend over 200 ms unless they are deliberate hard cuts.

### 5.12 Controls (default bindings, all rebindable)

Bind by `KeyboardEvent.code` so bindings work on any keyboard layout. **Never bind Ctrl or Meta combinations**: the browser reserves some of them, and Ctrl+W closes the tab.

| Action | Keyboard / mouse | Gamepad (standard mapping) |
|---|---|---|
| Aim / steer | Mouse (Mouse Aim) or W/S pitch, A/D roll | Left stick |
| Yaw | Q / E | LB / RB |
| Throttle up (hold for afterburner at 100%) / down | Shift / X | RT / LT (analog) |
| Guns | Left mouse button | X (hold) |
| Fire missile / weapon | Right mouse button or Space | A |
| Cycle weapon | Tab | D-pad up |
| Lock or cycle target / look at target | T / hold C | Y / hold Y |
| Flares / chaff | F / G | B / D-pad down |
| Camera cycle / free look | V / hold middle mouse | View / right stick |
| Landing gear / airbrake / flaps | L / B / K | D-pad left / LT at idle / D-pad right |
| Wingman commands 1 to 4 | 1 to 4 | Hold RB + face button |
| Map / scoreboard | M | Hold View |
| Pause | Esc | Start |
| HUD toggle / perf overlay | H / F3 | n/a |

Include sensitivity, invert pitch, deadzone (radial) and response curve settings. Detect binding conflicts and ask before replacing. Show glyphs for the active device (keyboard or gamepad) automatically in prompts.

### 5.13 Audio

Everything works with **procedural synthesis**, with optional sample overrides.

- **Engine:** layered oscillators plus filtered noise mapped to RPM. Afterburner adds a low rumble. Outside the jet you hear the intake whine from the front and a nozzle roar from behind. Inside the cockpit the sound is filtered.
- **Wind** noise scales with speed and AoA. Add buffet rumble near the stall and a G-strain breathing loop above 7 G.
- **Weapons:** gun bursts with a transient and a tail, missile launch whoosh and motor hiss, explosions (noise, a sub-bass thump and delayed rumble with distance filtering), and flare pops.
- **Cockpit tones:** IR seeker growl that rises to a steady tone when locked, radar lock tones, RWR search, spike and launch warnings, stall horn, and a "PULL UP" annunciator tone (with the text shown on the HUD).
- **Radio callouts:** subtitled text lines with a short radio squelch sound, using authentic brevity: *Fox Two*, *Fox Three*, *Guns guns guns*, *Splash one*, *Tally*, *Bandit*, *Spike*, *Winchester*, *Bingo*.
- **Spatial audio:** HRTF panning for nearby sources and **manual doppler** via `playbackRate` or `detune` (Web Audio's panner doppler was removed). Fade over distance and occlusion.
- **Mixer:** buses for master, music, effects, UI and radio. Radio ducks effects. The master bus has a compressor and limiter. Each category has a voice limit with priority.
- **Music:** if no licensed tracks are in `public/audio/music/`, ship a tasteful synthesized ambient pad for the menus and **no** combat music, rather than bad music.

---

## 6. World rendering and art direction

The goal is **grounded, atmospheric and cinematic**: think photographic references of real airshows and landscapes, not "video game default".

- **Color pipeline:** sRGB output, linear lighting, textures tagged with the correct color space (color maps sRGB, data maps linear), and **one** tone mapping pass (AgX or ACES in the post chain, with renderer tone mapping off). Use half-float render targets and a subtle color-grading LUT per map.
- **Sky and atmosphere:** a physically based sky (Rayleigh and Mie scattering) driven by a single `sun` direction. That same direction drives the directional light, shadows, sky, fog, water specular and lens flare. The **fog color is sampled from the atmosphere for each view direction** (aerial perspective), so distant terrain blends into the actual horizon color. Dither the sky to prevent banding.
- **Terrain:** quadtree or CDLOD chunks generated in workers. Use fBm plus ridged multifractal plus domain warping plus a fast erosion approximation, so the terrain has valleys, ridgelines and drainage rather than noise blobs. **Geomorph** between LOD levels in the vertex shader (no popping), and add **skirts** so chunks never show cracks. Splat materials by slope, height and curvature (rock, grass, dirt, sand, snow) using **triplanar** mapping on steep slopes, detail normals up close, macro variation far away and a distant color map.
- **Vegetation and structures:** instanced trees in believable clusters (along valleys and slopes, never uniformly random). Settlements follow roads and coastlines. Airbases have taxiways, hangars, painted runway markings (with polygon offset) and approach lights. Use `BatchedMesh` or instancing throughout.
- **Water:** world-space Gerstner and FFT-like normal layers, Fresnel, sun glint, depth-based color and shoreline foam, reflecting the sky environment map. Planar reflections are Ultra only.
- **Clouds:** clusters of impostor clouds, each 20 to 60 soft billboards shaded from a baked 3D-noise sprite atlas and lit by the sun direction. Sort them per cluster, fade them with depth (soft particles) and fade them out as the camera approaches. Flying through a cloud applies a volumetric fog overlay and water droplets on the canopy in cockpit view. Ultra can use raymarched clouds at half resolution.
- **Lighting:** the directional sun uses stabilized cascaded shadow maps (texel-snapped). Add hemisphere and environment lighting from a PMREM of the sky, updated when the time of day changes (never every frame). Night maps add a moon, city emissives, searchlights and explosion lights, pooled and capped.
- **Post-processing** (in order): SMAA or MSAA, bloom (threshold ≥ 1.0 in HDR, clamped), tone mapping, LUT grade, a subtle vignette, and optional film grain (0.02). Motion blur is off by default. Heat haze behind the nozzles is High and above only.
- **Effects** (`fx/`): at load, bake sprite atlases on the GPU for explosions, smoke, fire, sparks, dust and water spray, generated from noise shaders. Explosions have a flash, a fireball, rolling smoke, sparks and debris with physics, plus a light pulse. Missile trails are ribbon meshes (fixed-size ring buffers updated in place). Add contrails above 8,000 m, wingtip vortices and vapor cones at high G or transonic speed, afterburner flames with shock diamonds, tracers, flares, impact sparks and water splashes. All effects are pooled and capped.

---

## 7. Aircraft art (procedural, high quality)

External models can't be relied on, so the jets are **generated in code with care**. Optional: if CC0 `.glb` files are placed in `public/models/`, load them instead and record their licenses in `CREDITS.md`.

- **Fuselage:** lofted from cross-section splines along the length (nose cone, radome, cockpit hump, intakes, spine, engine section and nozzle), not stacked primitives. Use smooth normals with hard edges only where the design needs them.
- **Wings and tails:** extruded airfoil profiles with sweep, taper, dihedral and twist, rounded leading edges and sharp trailing edges. Add canards on the Wyvern, twin tails on the Harrow and Borzoi, and chined, faceted surfaces on the Nightjar.
- **Details:** intakes with visible depth, nozzle petals (animated with throttle), a canopy with frame and glass (clearcoat, environment reflection, slight tint), a pilot and seat silhouette, pitot tube, antennas, pylons and ordnance that **visibly disappear when fired**, and landing gear with bays and doors.
- **Moving parts:** ailerons, elevators or stabilators, rudders, flaps, airbrake, gear retraction and extension (about 6 s), and canopy open in the hangar.
- **Lights:** red on the left, green on the right, white on the tail, plus anti-collision strobes with **per-aircraft random phase**. Formation lights on night maps.
- **Materials:** `MeshPhysicalMaterial` with **generated canvas textures**. Include camouflage patterns per livery, panel lines and rivets (normal map), subtle weathering (exhaust soot, grime at panel edges, leading-edge wear), fictional squadron markings, tail codes and stenciled warnings ("NO STEP", "RESCUE"). Every jet has at least 3 liveries.
- **LODs:** LOD0 has 12k to 25k triangles, LOD1 about 4k and LOD2 about 800. Beyond 6 km, use an impostor sprite that always renders at least 2 px, so distant aircraft are still visible as dots. LOD switching uses hysteresis.
- Validate the generators with unit tests: no inverted normals, no degenerate triangles, and bounding boxes within the expected dimensions.

---

## 8. UI and UX design system

### 8.1 Principles

The interface should look like **avionics and a squadron ready room**, not a web app template. It is restrained, precise and confident. Hierarchy comes from typography and space, not from color or glow. The live 3D scene is the hero; UI panels frame it.

### 8.2 Tokens (CSS custom properties; use nothing else)

```css
:root {
  --ink-900: #0A0C0D;  --ink-800: #111416;  --ink-700: #1A1E21;  --line: #2A3034;
  --bone:    #E9E5D9;  --muted:   #8C938E;  --dim:     #5A615D;
  --signal:  #FF6A1A;  /* international orange: selection and critical CTA only, under 5% of the screen */
  --hud-green: #9DF2B4; --hud-amber: #FFC24B; --hud-white: #EAF2EE;
  --friend:  #5AB8FF;  --foe: #FF4D3D;  --ok: #5BD6A0;  --warn: #FFC24B;
  --space-1: 4px; --space-2: 8px; --space-3: 12px; --space-4: 16px; --space-6: 24px; --space-8: 32px; --space-12: 48px;
  --radius: 2px;       /* nearly square corners; no pills */
  --ease-out: cubic-bezier(.2,.8,.2,1);  --t-fast: 120ms; --t-base: 180ms; --t-slow: 320ms;
}
```

Friend and foe are **never** told apart by color alone: friendlies use circles and brackets, enemies use diamonds, and colorblind palettes can be selected.

### 8.3 Typography (self-hosted, OFL)

- **Display and labels:** Barlow Condensed 600/700, uppercase, letter-spacing +0.06 to +0.1 em.
- **Body:** IBM Plex Sans 400/500.
- **Numbers, HUD and data:** JetBrains Mono or IBM Plex Mono with **tabular figures**.
- Type scale: 12 / 14 / 16 / 20 / 28 / 40 / 64 px. Don't invent sizes between them.
- Show the UI only after `document.fonts.ready`, so fallback fonts never flash.

### 8.4 Layout and motion

- Use a 12-column grid with an 8 px baseline and left-aligned, asymmetric layouts. Use hairline 1 px rules, corner brackets and registration marks, and small technical annotations (for example `LOADOUT // STN 3`) as texture, sparingly.
- Motion is purposeful and quick. Items enter with 8 px of travel plus a fade over 180 ms, staggered 30 ms apart. The selection bar slides between items with a spring. Screen transitions cross-fade over 250 ms. Animate only `transform` and `opacity`.
- **UI sound:** subtle hover ticks, confirm and back sounds with ±3% pitch variation, rate-limited.
- Every interactive element has hover, focus-visible, active and disabled states. A disabled element explains why in a tooltip.
- Full **keyboard and gamepad navigation** with visible focus. Esc and gamepad B always go back.

### 8.5 Screens

1. **Title:** a real-time shot of a jet flying low over clouds at sunset, with the wordmark (a custom SVG of "SPLASH ONE" set in condensed type, with a contrail slash through the "O") and "PRESS ANY KEY". The key press unlocks audio. Don't show fake publisher logos.
2. **Main Menu:** a live 3D hangar behind the menu (jet under spotlights, light shafts, dust motes, slow camera dolly). A left column holds SORTIE (Campaign), INSTANT ACTION, FREE FLIGHT, TRAINING, HANGAR, SETTINGS and EXIT. Hovering an item shows a context panel on the right with a description and a rendered preview. The bottom corners show pilot callsign, rank, XP bar and build version.
3. **Hangar:** a turntable jet. On the left, an aircraft list with thumbnails rendered from the actual models at load. On the right, stats **in real units** with comparison deltas against the current jet. Along the bottom, a loadout strip of hardpoints that shows weight, drag and the resulting performance change. Also tabs for liveries and callsign plate.
4. **Mode setup (Instant Action):** all options described in §5.1, with sensible defaults and a "Quick Start" option.
5. **Briefing:** a tactical map rendered from the actual heightmap (hillshade and contour lines baked to canvas) showing objectives, threat rings and waypoints. Shows mission text, weather, time and loadout review, and a BEGIN SORTIE button.
6. **Loading:** a map silhouette, a **real** progress bar driven by actual tasks (terrain chunks, shader warmup, audio), and rotating tips written as pilot knowledge.
7. **HUD:** see §8.6.
8. **Pause:** a single blurred snapshot of the frame (captured once, not a live blur), with Resume, Restart, Settings, Controls and Quit to Menu (Quit asks for confirmation).
9. **Debrief:** a MISSION COMPLETE or FAILED banner, a stats table (kills by weapon, accuracy, time, damage taken), a kill timeline, an XP bar that counts up, medals, and Retry, Continue and Hangar buttons.
10. **Settings:** see §8.8.
11. **Credits:** fonts, libraries and licenses.

### 8.6 HUD (Canvas 2D, collimated look)

- **Instruments:** pitch ladder (solid lines above the horizon, dashed below, numbered), flight path marker (velocity vector), boresight cross, heading tape, airspeed and altitude tapes with rolling digits, vertical speed, Mach, G and max G, AoA, throttle and afterburner cue, fuel.
- **Weapons:** selected weapon with its remaining count, seeker circle, lock diamond, range and closure rate, launch envelope bars, gun funnel and lead pip, and a CCIP pipper for ground attack.
- **Awareness:** target boxes with callsign, distance and type. Off-screen target and missile arrows. A rotating radar minimap with selectable range. An RWR display with threat symbols. A damage diagram of your own jet.
- **Warnings:** PULL UP, STALL, MISSILE (with direction), BINGO, OUT OF BOUNDS. Each has an audio cue and a priority, so only the most critical one flashes.
- **Feed:** a short kill feed, objective tracker and radio subtitles.
- **Readability:** the HUD color is selectable (green, amber or white), with a thin dark halo so it stays readable against bright snow or sky. Lines sit on the pixel grid, and numbers are snapped and use tabular figures. The HUD is drawn **after** post-processing, so bloom and haze never smear it.
- **Layout:** the HUD stays within a 16:9 safe area on ultrawide screens, with an option to widen it. HUD scale is adjustable from 80 to 140%.

### 8.7 Copy and voice

- Labels are UPPERCASE and short: SORTIE, LOADOUT, BEGIN SORTIE.
- Descriptions are sentence case and plain.
- Mission text uses a professional military documentary tone.
- No exclamation marks in menus, no hype words ("epic", "ultimate", "unleash"), no emojis, no second-person marketing.
- Error messages say what happened and what to do.

### 8.8 Settings (all functional, all persisted, applied live where possible)

- **Graphics:** preset (Low, Medium, High, Ultra, Custom), render scale, adaptive resolution, shadows, clouds, terrain detail, vegetation density, water, effects, anti-aliasing, bloom, heat haze, motion blur, FOV (60–100), show FPS.
- **Controls:** control scheme, sensitivity, invert pitch, deadzone, response curve, full rebinding with conflict detection, and reset to defaults.
- **Audio:** master, music, effects, radio and UI volumes (dB-mapped), and mute when the window loses focus.
- **Gameplay:** flight model (Standard or Sim), difficulty, units (kts/ft or km/h/m), HUD color, kill cam, auto-level assist, subtitles, auto countermeasures.
- **Accessibility:** UI scale, colorblind modes (protan, deutan, tritan), reduce camera shake, reduce flashes, hold versus toggle for held actions, high-contrast HUD.
- Only show settings that the browser can actually honor. For example, don't show a VSync toggle.

### 8.9 Accessibility baseline

All text meets a 4.5:1 contrast ratio. Everything is navigable without a mouse. There are no information-bearing flashes above 3 Hz when "reduce flashes" is on. Radio lines have subtitles. Critical warnings combine sound, text and shape.

---

## 9. Anti-"AI-generated look" rules

The fastest way to fail this project is to look generic. **Forbidden:**

- The default three.js look: gray, unlit or `MeshNormalMaterial` objects, primitive "planes" built from boxes and cones, a flat blue background, an untextured single-color ground, a perfectly uniform noise terrain.
- Generic web-app UI: purple or blue gradients, glassmorphism everywhere, neon glow, pill buttons, heavy drop shadows, centered hero text, cards in a uniform grid, emoji or mixed icon sets.
- Generic copy: "Welcome to the ultimate…", "Epic battles await!", "Unleash your inner pilot", stat bars with meaningless 0 to 100 numbers.
- Uniformly random scatter of trees and buildings. Real places have roads, clearings, clusters and reasons.
- Perfectly clean jets with no panel lines, weathering or markings. Explosions that are expanding orange spheres. Sound made of bare oscillator beeps.
- Linear easing everywhere, symmetric layouts everywhere, everything the same size.

**Required instead:** real units and real-feeling data, specific details (tail codes, stencils, callsigns, runway numbers matching the runway heading), intentional asymmetry, restraint, and consistency enforced by design tokens.

Before closing any visual phase, ask yourself: *"If I saw this screenshot on a store page, would I believe a studio made it?"* If the honest answer is no, keep iterating.

---

## 10. Performance contract

### 10.1 Reference hardware

- **Medium preset:** 1920×1080, Chrome, a 2020-era laptop with integrated graphics (Intel Iris Xe or Apple M1 class). **60 FPS locked, 1% low ≥ 55.**
- **High preset:** 2560×1440 on a GTX 1660 or RX 5600 class GPU. **60 FPS locked.**
- **Low preset:** playable at 60 FPS on older integrated graphics at 1280×720.

### 10.2 Budgets per frame (Medium preset)

| Budget | Limit |
|---|---|
| Total JavaScript on the main thread | ≤ 8 ms (sim ≤ 2.5, AI ≤ 1.0, render submission ≤ 3.5, HUD ≤ 0.7, audio ≤ 0.3) |
| GPU | ≤ 12 ms |
| Draw calls | ≤ 180 (High: ≤ 300) |
| Triangles | ≤ 1.2M (High: ≤ 2.5M) |
| Steady-state heap growth | < 1 MB per minute, with no GC pauses above 2 ms during play |
| Initial load to title screen | ≤ 4 s on broadband; main bundle ≤ 900 KB gzipped |
| Map load | ≤ 6 s, with real progress shown |

### 10.3 Techniques

- **Zero steady-state allocation:** module-level scratch vectors, object pools, no closures or `map`, `filter` or `forEach` in hot loops, and no string building per frame (the HUD caches number strings and only rebuilds them when a value changes).
- Instancing or `BatchedMesh` for bullets, particles, trees, buildings and lights. Merge static geometry.
- **Shader warmup:** during loading, call `renderer.compileAsync` and render every material and effect once off-screen, so the first explosion never hitches.
- Workers generate terrain. **Upload budget:** at most 2 chunk uploads and 1 texture initialization per frame.
- Frustum and distance culling, LOD with hysteresis, a pixel ratio cap per preset (Medium ≤ 1.25, High ≤ 1.5, Ultra ≤ 2).
- **Adaptive resolution** (on by default): uses the rolling p95 frame time. Step down by 10% (minimum 67%) when p95 exceeds 16.0 ms for 2 s. Step up only after 10 s below 12 ms. At most one change every 3 s, so quality never visibly oscillates.
- A spatial hash for the collision broad phase. AI decision ticks are staggered. Particle overdraw near the camera is limited.
- Depth precision: prefer reverse-Z if the installed three.js supports it (check that version's `WebGLRenderer` options), otherwise a logarithmic depth buffer. Tune near and far planes per camera, and keep vertex data local to each chunk. Add a floating origin if the world ever exceeds ±20 km from the origin.

### 10.4 Measurement

- **Perf overlay** (F3): FPS, frame-time graph, CPU breakdown by system, draw calls, triangles, geometries and textures, heap, and adaptive-resolution scale.
- **`npm run bench`:** builds for production, serves the build, and flies a scripted 60 s route over the densest area of each map with 12 AI aircraft fighting. It records per-frame CPU time, draw calls, triangles and heap, writes `artifacts/bench.json` and **fails on any budget breach**. Report the numbers in `docs/PROGRESS.md` after every phase.
- **In-game Benchmark mode** (Settings → Run Benchmark) reports average FPS, 1% low and p95 on the player's real GPU.

---

## 11. ZERO-DEFECT LIST: errors that must never exist

Copy this list into `docs/QA_REPORT.md` as a table (ID, status, how it's verified). Every item must be **verified** before the Definition of Done: by an automated test (preferred), a screenshot review or a documented manual check.

### A. Build, code and console

- **ZD-A01** TypeScript errors, implicit `any`, unsafe casts used to silence errors.
- **ZD-A02** Any `console.error`, `console.warn`, uncaught exception or unhandled promise rejection, at any time, in any mode. E2E tests fail on them.
- **ZD-A03** 404s, failed requests, CORS errors, runtime CDN fetches.
- **ZD-A04** three.js deprecation warnings, WebGL errors or warnings (`GL_INVALID_OPERATION`, texture format mismatch, and so on), shader compile warnings.
- **ZD-A05** TODO, FIXME, stubs, `not implemented`, commented-out code blocks, `console.log`, `debugger` in shipped code.
- **ZD-A06** Lint errors, blanket `eslint-disable`, `@ts-ignore` or `@ts-expect-error` without a written justification.
- **ZD-A07** Unexplained production build warnings (chunk size, circular dependencies).
- **ZD-A08** Debug code, cheat keys or the test API present in the production bundle.
- **ZD-A09** Magic tuning numbers inline in logic instead of in `src/data`.

### B. Flicker, z-fighting and visual artifacts

- **ZD-B01** Z-fighting: runway versus terrain, decals, water versus shore, cockpit layers, distant mountains. Prevent it with the depth strategy (§10.3), polygon offset for coplanar details and no coplanar surfaces.
- **ZD-B02** Shadow acne (striped self-shadowing).
- **ZD-B03** Peter-panning (floating shadows from over-biasing).
- **ZD-B04** Shadow shimmer or swimming when the camera moves. Use texel-snapped, stabilized cascades.
- **ZD-B05** LOD popping on terrain, aircraft or props. Use geomorphing, hysteresis and dithered crossfade.
- **ZD-B06** Cracks, gaps or T-junction holes between terrain chunks. Use skirts and stitched edges.
- **ZD-B07** Alpha-sorting flicker on clouds, smoke, canopy glass or particles. Use explicit render order, per-system sorting, premultiplied alpha and `depthWrite: false` on transparent materials.
- **ZD-B08** Hard lines where particles or clouds intersect geometry. Use soft particles.
- **ZD-B09** A flat cloud billboard visible when the camera is inside or near a cloud.
- **ZD-B10** Banding in the sky, fog or dark gradients. Use dithering and half-float targets.
- **ZD-B11** Washed-out or crushed colors, double gamma, double tone mapping, wrong texture color spaces.
- **ZD-B12** Bloom blowouts, fireflies or specular sparkle, and NaN or black pixels from shaders.
- **ZD-B13** Crawling jagged edges on wings, antennas, cables or HUD lines.
- **ZD-B14** Texture shimmer or moiré on distant terrain and runways. Use mipmaps and anisotropic filtering.
- **ZD-B15** Stretched textures on cliffs. Use triplanar mapping.
- **ZD-B16** Obvious texture tiling repetition.
- **ZD-B17** Fog and terrain color not matching the sky at the horizon.
- **ZD-B18** A visible world edge, void, or black area under the horizon at high altitude.
- **ZD-B19** Sun disk, light direction, shadows, specular highlights and lens flare out of alignment.
- **ZD-B20** Lens flare popping on or off through terrain or aircraft. Fade occlusion over 150 ms.
- **ZD-B21** White or black flashes on load, screen change, resize or fullscreen toggle.
- **ZD-B22** A stretched or squashed image after resize. Update camera, composer and render targets in one handler.
- **ZD-B23** A blurry canvas or HUD on HiDPI screens.
- **ZD-B24** The camera clipping into terrain, water, buildings or the player's own jet.
- **ZD-B25** Near-plane clipping of the nose or canopy in chase or cockpit view.
- **ZD-B26** Inverted normals, missing faces, see-through seams or holes in the jet meshes.
- **ZD-B27** Magenta, black or missing-texture materials, or default gray meshes.
- **ZD-B28** Nav and strobe lights blinking in sync on every aircraft.
- **ZD-B29** Vertex wobble or jitter far from the origin (precision).
- **ZD-B30** Water tile seams, sparkling aliasing, hard shorelines.
- **ZD-B31** HUD flicker, number jitter or subpixel shimmer.
- **ZD-B32** DOM UI flicker or tearing during animations or layout thrash.
- **ZD-B33** Bloom or heat haze bleeding over the HUD.
- **ZD-B34** Particles or trails snapping out of existence when pools recycle.
- **ZD-B35** Motion judder of the jet or camera at a steady 60 FPS, caused by missing interpolation or wrong update order.
- **ZD-B36** Distant aircraft vanishing: they must stay at least a 2 px dot, as in real life.

### C. Performance, stutter and memory

- **ZD-C01** Below 60 FPS on reference hardware at the default preset.
- **ZD-C02** A hitch the first time an effect, material, weapon or map feature is used (shader compile). Warm everything up while loading.
- **ZD-C03** Hitches while streaming terrain or uploading textures.
- **ZD-C04** GC pauses caused by per-frame allocations.
- **ZD-C05** Memory leaks across restarts or mode switches: geometries, materials, textures, render targets, audio nodes, listeners, workers, timers.
- **ZD-C06** Unbounded bullets, particles, trails, decals, debris, lights or audio voices. Every one has a hard cap and a pool.
- **ZD-C07** Draw-call explosions from unbatched or uninstanced repeated objects.
- **ZD-C08** A spiral of death after a hitch.
- **ZD-C09** A huge time step after tab switches or breakpoints causing teleports or crashes.
- **ZD-C10** Game speed tied to the refresh rate.
- **ZD-C11** Judder from `setTimeout` or `setInterval` loops.
- **ZD-C12** Main-thread tasks over 8 ms during gameplay.
- **ZD-C13** Adaptive resolution visibly pumping or oscillating.
- **ZD-C14** O(n²) collision or AI queries.
- **ZD-C15** Excessive overdraw from smoke or clouds filling the screen.
- **ZD-C16** A slow first load or oversized bundle. Code-split menus from gameplay and lazy-load maps.
- **ZD-C17** Rendering at full 4K device pixel ratio on weak GPUs.

### D. Simulation and physics

- **ZD-D01** Gimbal lock or sudden flips near vertical.
- **ZD-D02** Quaternion drift.
- **ZD-D03** NaN or Infinity propagation (zero velocity, normalizing a zero vector, `acos` out of range). Use safe math helpers, plus a dev assertion that freezes and reports the first NaN.
- **ZD-D04** Bullets or missiles tunneling through targets.
- **ZD-D05** Aircraft passing through terrain at high speed.
- **ZD-D06** Unphysical flight: infinite climb, no energy loss in turns, full turn rate at stall speed, stalling at 1,000 km/h.
- **ZD-D07** Missiles orbiting targets forever or turning beyond their G limit.
- **ZD-D08** Missiles hitting their own launcher.
- **ZD-D09** Locking on through mountains or outside the seeker gimbal.
- **ZD-D10** Flares that are 100% or 0% effective regardless of timing and aspect.
- **ZD-D11** Splash damage passing through terrain.
- **ZD-D12** Spawning inside terrain, buildings or other aircraft.
- **ZD-D13** False ground collisions on the runway, or missed collisions when landing gear-up.
- **ZD-D14** Different results for the same seed (a stray `Math.random` in gameplay).

### E. Gameplay and game flow

- **ZD-E01** Kills counted twice, credited to the wrong player, or assists lost.
- **ZD-E02** Friendly fire behaving inconsistently with the settings.
- **ZD-E03** Objectives completing twice, never triggering or triggering out of order.
- **ZD-E04** Softlocks: no way to finish, fail, retry or exit a mission or lesson.
- **ZD-E05** Pause not pausing everything: audio, timers, AI, particles, missiles, tweens.
- **ZD-E06** Double-clicking Start launching two sessions, or duplicated listeners.
- **ZD-E07** Restart leaving old entities, sounds or timers alive.
- **ZD-E08** Out of bounds with no warning, or instant death.
- **ZD-E09** Taking off or landing through buildings, getting stuck on the ground, or a gear-up landing not handled.
- **ZD-E10** Ammunition counts out of sync with the ordnance visible on the pylons.
- **ZD-E11** Respawning into gunfire with no protection window. Give 3 s of protection that ends when the player fires.
- **ZD-E12** Displayed values showing NaN, `undefined`, negative numbers or unformatted numbers.
- **ZD-E13** Difficulty or rule settings that change nothing.
- **ZD-E14** Mission end or debrief firing twice, or never firing.

### F. AI behavior

- **ZD-F01** AI flying into terrain or water (target crash rate under 1% in the soak test).
- **ZD-F02** AI mid-air collisions in furballs.
- **ZD-F03** Endless circling stalemates.
- **ZD-F04** AI never firing missiles, or dumping all of them at once.
- **ZD-F05** AI ignoring incoming missiles, or reacting with superhuman instant precision.
- **ZD-F06** AI leaving the combat area.
- **ZD-F07** Wingmen who are useless, or who steal every kill.
- **ZD-F08** Oscillating or jittery AI control inputs.
- **ZD-F09** All AI pilots flying identically.
- **ZD-F10** AI stuck in stalls or spins.
- **ZD-F11** AI cheating: seeing through terrain, perfect aim, physics the player doesn't have.

### G. Camera

- **ZD-G01** Camera jitter from the wrong update order.
- **ZD-G02** Nauseating snaps when switching cameras.
- **ZD-G03** Harsh per-frame random shake.
- **ZD-G04** Losing orientation with no way to find the target (padlock and target camera required).
- **ZD-G05** Horizon "swimming" from badly tuned roll lag.
- **ZD-G06** Fisheye distortion from FOV effects.

### H. Input

- **ZD-H01** Stuck keys or buttons after Alt-Tab or focus loss. Clear all input on `blur` and `visibilitychange`.
- **ZD-H02** Browser shortcuts hijacking play: Space scrolling the page, Tab moving focus, F1, F3, F5, Backspace. Call `preventDefault` for bound keys during play, and never bind Ctrl or Meta combinations.
- **ZD-H03** Broken bindings on AZERTY or QWERTZ keyboards. Bind by `code` and show labels from the actual layout.
- **ZD-H04** Pointer lock errors: an unhandled rejected promise, relocking too soon after Esc (respect the roughly 1 s cooldown), or losing lock silently. Show a "Click to resume" overlay.
- **ZD-H05** Mouse sensitivity that varies with frame rate.
- **ZD-H06** Gamepad drift, no deadzone, wrong mapping, or a crash on disconnect (auto-pause instead).
- **ZD-H07** Context menu, text selection or drag ghosting on the game canvas.
- **ZD-H08** Menus that can't be navigated with keyboard or gamepad, or invisible focus.
- **ZD-H09** Binding conflicts accepted silently.
- **ZD-H10** Input leaking between contexts, such as the click on "Resume" also firing the gun.

### I. Audio

- **ZD-I01** No sound because the `AudioContext` was never resumed. Resume it on the title-screen key press.
- **ZD-I02** Clicks or pops when sounds start or stop. Use gain ramps of at least 5 ms.
- **ZD-I03** Clipping when many explosions play at once. Use a compressor, a limiter and voice caps.
- **ZD-I04** Loops continuing after pause, restart or returning to the menu.
- **ZD-I05** No distance attenuation or occlusion.
- **ZD-I06** Flybys with no doppler.
- **ZD-I07** Audio playing while the tab is hidden, when the player has muted it for that case.
- **ZD-I08** Repetitive or too-loud UI sounds.
- **ZD-I09** Volume sliders that are non-linear or ineffective. Map them in dB.

### J. UI and HUD

- **ZD-J01** Text overlapping, clipping or overflowing at any supported resolution (1280×720 to 3840×2160, aspect ratios 4:3 to 32:9) or UI scale.
- **ZD-J02** HUD stretched on ultrawide screens or outside the safe area.
- **ZD-J03** Placeholder text: lorem ipsum, TODO, "Coming soon", "Button", `undefined`, `NaN`, `[object Object]`.
- **ZD-J04** Missing hover, focus, active or disabled states, or disabled items with no explanation.
- **ZD-J05** Inconsistent spacing, type sizes, corner radii or icon styles. Tokens only.
- **ZD-J06** Font flashes (FOUT or FOIT).
- **ZD-J07** Numbers changing width as they update (no tabular figures).
- **ZD-J08** Low-contrast text, or a HUD that's unreadable against bright sky or snow.
- **ZD-J09** A loading bar that lies: stuck at 99%, or driven by a fake timer.
- **ZD-J10** Settings that don't apply, don't persist, or silently need a reload.
- **ZD-J11** Dead-end screens or inconsistent back behavior.
- **ZD-J12** Notifications or toasts stacking without limit.
- **ZD-J13** A pause-menu flash or flicker when it opens.
- **ZD-J14** Tooltips running off the screen.
- **ZD-J15** Modals that can open twice.
- **ZD-J16** Kill feed, objectives or subtitles overflowing their areas.

### K. Save and settings

- **ZD-K01** A crash on corrupt or old saved data. Validate, migrate, fall back to defaults and show a non-blocking notice.
- **ZD-K02** Progress lost on reload. Save on meaningful changes (debounced) and on `pagehide`.
- **ZD-K03** A crash when storage is unavailable (private mode). Fall back to memory.
- **ZD-K04** Two open tabs corrupting each other's saves.

### L. Browser and platform

- **ZD-L01** A blank page when WebGL2 is unavailable. Show a clear full-screen message instead.
- **ZD-L02** A frozen or black screen after WebGL context loss. Handle lost and restored events, rebuild resources and resume.
- **ZD-L03** Fullscreen requests failing silently, or exiting fullscreen breaking pointer lock state.
- **ZD-L04** A broken experience on touch-only devices. Show a clear "desktop and controller required" screen.
- **ZD-L05** Incorrect behavior at 120, 144 or 240 Hz.
- **ZD-L06** Browser-specific breakage in Chrome, Edge, Firefox or Safari.
- **ZD-L07** Layout breaking at 80 to 150% browser zoom.
- **ZD-L08** Leaving mid-mission with no warning when progress would be lost.

### M. "Looks AI-generated" defects

- **ZD-M01** Any item on the forbidden list in §9 is present.
- **ZD-M02** A screenshot fails the store-page test in §9.
- **ZD-M03** Copy contains hype words, exclamation marks in menus, emojis or generic filler.

---

## 12. Testing and QA

### Unit tests (Vitest)

- **Flight model:** trimmed level flight holds altitude within ±15 m for 10 s. Stall happens at `alphaStall`. Turn rate is capped by the G limit. Energy stays plausible in unpowered climbs and dives. Each jet's top speed, climb rate and sustained turn match its stats within ±5%. Results are identical whether the render rate is 30, 60 or 144 Hz.
- **Guidance:** across 200 seeded geometries, PN missiles hit non-maneuvering targets ≥ 95% of the time. Against a well-timed break plus flares, defeat rates fall in the expected ranges. No NaN in any case.
- **Ballistics:** lead computation is correct, and 1,050 m/s rounds don't tunnel through small targets.
- **AI:** from 1,000 random states near terrain, the crash rate is under 1%. In AI-versus-AI fights, kills happen within the expected time range (no endless stalemates).
- **Systems:** save migration from every old version, corrupt data falls back to defaults without throwing, rebinding conflict detection, input cleared on blur, pools release everything, seeded determinism, and mesh generator validity (normals, degenerate triangles, bounds).

### End-to-end tests (Playwright)

A shared fixture fails any test on `console.error`, `console.warn`, `pageerror` or `requestfailed`.

- Boot to the title, press a key, reach the menu. Fonts are loaded and there's no flash.
- Navigate every menu screen by **keyboard only**, change every setting, reload and confirm they persisted.
- Start every mode on every map with a fixed seed, fly 30 s on autopilot, check the state transitions and capture screenshots.
- Go from menu to mission, end the mission, see the debrief and return to the menu, **5 times**. `renderer.info.memory` and the entity counts return to baseline, which catches leaks.
- Soak: 10 minutes of a 12-aircraft AI-versus-AI dogfight (shorter in quick runs). No errors, heap growth under budget, no AI stuck.
- Resize, fullscreen, tab-hide (`visibilitychange`) and focus-loss scenarios: the game auto-pauses and has no stuck inputs.
- Screenshots at 4 resolutions for UI review (§2.6).

### Manual QA checklist

Keep this in `docs/QA_REPORT.md`: gamepad play-through, pointer lock edge cases, audio mix listening pass, and a full Training and Campaign play-through.

---

## 13. Phases and gates

Each phase ends with every gate green, a visual critique (where relevant), reviewer-agent findings fixed, `docs/PROGRESS.md` updated, a commit and a push.

| Phase | Work | Mode | Gate highlights |
|---|---|---|---|
| **0: Orient and plan** | Plan mode. Scaffold Vite and strict TypeScript, ESLint, Prettier, Vitest and Playwright, all npm scripts, the guard script. Write `CLAUDE.md`, `PLAN.md` (with a risk register), `PROGRESS.md`, `ARCHITECTURE.md`, `DECISIONS.md` and `QA_REPORT.md` (Zero-Defect list, all unchecked). Render an empty scene. | Serial | `check` and `e2e` green; boot test passes with zero console output |
| **1: Engine core** | Loop, time, seeded RNG, typed events, pools, safe math, state machine, input (keyboard, mouse and gamepad, contexts, rebinding model), settings and save, renderer (color management, depth strategy, resize, DPR cap, context loss), post chain, shader warmup, sprite-atlas baker, loading screen with real progress, perf overlay, debug API. **Freeze interfaces** in `ARCHITECTURE.md`. | Serial | Unit tests for loop, input, pools and save; CPU bench on the empty world within budget |
| **2: Vertical slice (Free Flight)** | Flight model (Standard and Sim), full-quality Kestrel, chase, cockpit and free-look cameras, core HUD, **Kessel Strait at full quality** (terrain, water, sky, clouds, airbase), engine and wind audio, contrails and vapor, minimal main menu into Free Flight. | Serial | **The most important gate.** Budgets met on Map 1, at least 2 visual critique passes, and the slice passes the store-page test (§9). Do not start Phase 3 with an ugly slice |
| **3: Combat** | Guns, SRM and MRM, targeting, lock-on, RWR, countermeasures, damage model, all combat effects, combat audio, target drones, gunnery and missile training lessons. | Serial | Guidance and ballistics tests; no hitch on first explosion (bench checks max frame time) |
| **4: AI and Dogfight** | AI stack and skill profiles, Instant Action setup, teams, scoring, respawn, radio callouts, debrief, BFM and defensive lessons. | Serial | 10-minute AI soak: crash rate under 1%, kills happen; 5-cycle leak test |
| **5: Content fan-out** | **Parallel subagents** (§2.4): (a) Mesa Roja and Norrdal Fjords, then Port Varen and Typhoon Line; (b) Harrow, Wyvern, Borzoi, Mule and Nightjar models and liveries; (c) full menus, hangar, briefing, debrief and settings UI; (d) audio polish and mixer; (e) remaining training lessons. Merge one stream at a time. | **Parallel** | Full gate after **each** merge; screenshot review per stream |
| **6: Campaign and systems** | Mission scripting, 9 campaign missions, wingmen commands, ground attack weapons and targets (SAMs, AAA, ships), Survival, progression and unlocks. | Mixed | Every mission playable start to finish on autopilot plus scripted e2e |
| **7: Polish** | Art pass on every map and jet, UI pass on every screen at 4 resolutions, game feel (camera, hit feedback, audio), accessibility, quality presets, adaptive resolution, benchmark mode, photo mode. | Serial plus reviewers | Store-page test on every screen; budgets met at every preset |
| **8: Hardening and ship** | Parallel reviewer agents, one per group of §11 categories. Fix every finding. Full soak tests. Browser matrix. `README.md`, `CONTROLS.md`, `CREDITS.md`, `CHANGELOG.md`. Complete `QA_REPORT.md`. | Parallel review, serial fixes | Definition of Done (§14) |

---

## 14. Definition of Done

All of the following must be true. Check each one explicitly and report it in `docs/PROGRESS.md`.

- [ ] `npm run check`, `npm run e2e` and `npm run bench` are green on the final commit.
- [ ] Zero console errors or warnings across all automated flows.
- [ ] Every item in §11 is verified in `docs/QA_REPORT.md`, with the method used.
- [ ] Performance budgets (§10) are met at the Low, Medium and High presets, with numbers recorded.
- [ ] Every mode, map, jet, weapon, lesson and mission listed in §5 is implemented and reachable, or honestly listed as not done in `PROGRESS.md` and hidden from the UI.
- [ ] A new player can: boot, finish Training lesson 1, win or lose a dogfight, see the debrief, change settings, reload the page and find progress and settings intact.
- [ ] Every screen passes the store-page test (§9) at 1920×1080, and the UI is intact at 1280×720, 21:9 and 4:3.
- [ ] `README.md` explains how to install, run, build and test, plus the controls, the system requirements and the project structure.
- [ ] Everything is committed and pushed.

---

## 15. Begin

1. Summarize your understanding of this project in 10 lines or fewer, and list the 5 biggest risks with how you'll handle each.
2. Enter Plan mode and run **Phase 0**.
3. Keep going phase by phase using the dynamic workflow (§2), without waiting for approval, until the Definition of Done (§14) is met.

Build it like it's shipping.
