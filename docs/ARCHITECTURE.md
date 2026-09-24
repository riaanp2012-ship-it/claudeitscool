# Architecture

## Module map and ownership

| Path | Responsibility | Owner |
|---|---|---|
| `src/core/` | rng, math, events, pool, storage, settings, profile, loop, debug API, **types.ts (contracts)** | orchestrator |
| `src/render/` | renderer + post chain, shared atmosphere (`atmosphere.ts`), ground shadow, quality, perf overlay | orchestrator |
| `src/input/` | keyboard, mouse (pointer lock or cursor), gamepad, action map, rebinding | orchestrator |
| `src/flight/` | flight model, control laws, instructor (mouse-aim) autopilot | orchestrator |
| `src/aircraft/` | aircraft entity: systems, damage, visuals glue | orchestrator |
| `src/weapons/` | guns, missiles, guidance, lock-on, countermeasures, RWR | orchestrator |
| `src/ai/` | AI pilots | orchestrator |
| `src/camera/` | camera rigs | orchestrator |
| `src/modes/` | session, free flight, instant action, training, campaign, survival | orchestrator |
| `src/world/` | `createWorld`: heightmap, terrain, water, sky, clouds, vegetation, structures, map definitions | world worker |
| `src/art/` | `createAircraftModel`, `createOrdnanceModel`: procedural jets, liveries, LODs | art worker |
| `src/fx/` | `createFx`: particles, trails, explosions, tracers, glows, flashes | fx worker |
| `src/audio/` | `createAudio`: procedural engine/weapon/UI audio, mixer, tones | audio worker |
| `src/hud/` | `createHud`: canvas HUD | hud worker |
| `src/ui/` | `createUi`: menus, design tokens, fonts, screens | ui worker |

Each worker module exports exactly one factory matching `src/core/types.ts`:

```ts
// src/world/index.ts
export const createWorld: WorldFactory;
// src/art/index.ts
export const createAircraftModel: AircraftModelFactory;
export const createOrdnanceModel: OrdnanceModelFactory;
// src/fx/index.ts
export function createFx(): Fx;
// src/audio/index.ts
export function createAudio(): AudioSystem;
// src/hud/index.ts
export function createHud(): Hud;
// src/ui/index.ts
export function createUi(container: HTMLElement): Ui;
```

## Frame order

`input.poll → sim.step × N (fixed 120 Hz) → interpolate(alpha) → camera → world.update → fx.update → audio → hud.draw → composer.render`

## Rendering

- `WebGLRenderer({ antialias: false, logarithmicDepthBuffer: true, powerPreference: 'high-performance' })`,
  `outputColorSpace = SRGBColorSpace`, `toneMapping = NoToneMapping` (tone mapping is an effect in the post chain).
- pmndrs `EffectComposer` with HalfFloat buffers → RenderPass → EffectPass(SMAA, Bloom, ToneMapping(AgX), Vignette).
- The HUD is a separate 2D canvas above the WebGL canvas, drawn after post-processing.
- Shared atmosphere uniforms and GLSL: `src/render/atmosphere.ts`.
- Aircraft ground shadows: a coverage texture rendered from the sun around the player, exposed via
  `atmoUniforms.uGroundShadow*` and sampled with `atmoGroundShadow(worldPos)`.

## Data

`src/data/aircraft.ts` (flight model + design brief + hardpoints), `src/data/maps.ts` (metadata), weapons, lessons, missions.
