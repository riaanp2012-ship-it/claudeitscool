# SPLASH ONE: working rules

- Spec (source of truth): `FIGHTER_JET_GAME_PROMPT.md`. Progress: `docs/PROGRESS.md`. Decisions: `docs/DECISIONS.md`.
- Module contracts are frozen in `src/core/types.ts` (see `docs/ARCHITECTURE.md`). Propose changes; don't edit casually.
- Before every commit: `npm run check` (typecheck, lint, guard, unit tests, build) and `npm run e2e`.
  Run `npm run bench` for anything that can affect performance.
- Visual check: `node scripts/shot.mjs <url> artifacts/screens/<name>.png` then open the PNG and critique it.
  Harness pages live in `harness/<name>.html` + `src/harness/<name>.ts` and set `window.__HARNESS_READY__ = true`.
  Use a unique `PORT` for your dev server (`PORT=51xx npx vite`).
- Never: skip or weaken tests, `@ts-ignore`, blanket `eslint-disable`, TODO/FIXME/placeholders, `console.log`,
  bind Ctrl/Meta combos, allocate in per-frame code, or call `Math.random` (use `src/core/rng.ts`).
- Frame order: input → sim (fixed 120 Hz) → interpolate → camera → world.update → fx/audio → HUD → render.
- Units: SI (m, m/s, kg, N, rad); 1 world unit = 1 m. World: +Y up, -Z north. Aircraft local: nose -Z, up +Y, right +X.
- Tuning values live in `src/data/**`. Every world/aircraft material uses `patchAtmosphere` or `ATMOSPHERE_GLSL`
  from `src/render/atmosphere.ts` so fog, sky and sun always agree.
- Renderer: WebGL2, `logarithmicDepthBuffer: true`, linear HDR into pmndrs `postprocessing` (AgX tone mapping there;
  renderer tone mapping stays off). Custom ShaderMaterials must include three's `logdepthbuf` chunks.
- three.js is pinned to 0.186.x (postprocessing peer range). Read `node_modules/three/src` when unsure of an API.
