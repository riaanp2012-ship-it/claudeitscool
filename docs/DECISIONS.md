# Decisions

## D1: Dependency versions (Phase 0)
three 0.186.0 (pinned ~0.186 because postprocessing 6.39.5 requires three < 0.187), postprocessing 6.39.5,
Vite 8.3, TypeScript 6.0.3 (TS 7 is not yet supported by typescript-eslint 8.70), Vitest 5, Playwright 1.63,
ESLint 10 + typescript-eslint 8.70, Prettier 3.9, @fontsource Barlow Condensed / IBM Plex Sans / JetBrains Mono.

## D2: Menus are plain TypeScript + DOM instead of Preact
The spec suggests Preact. Menus here are a small set of screens with simple state; a tiny `el()` helper
keeps them dependency-free and avoids JSX configuration. Design tokens are CSS custom properties as specified.

## D3: Logarithmic depth buffer
Maps are 40 km with a far plane near 150 km and a cockpit near plane of 0.1 m. A logarithmic depth buffer removes
z-fighting (ZD-B01) at the cost of early-z on some fragments. Water hides itself where terrain is above the water
level (heightmap test) and runways are painted by the terrain shader, so no coplanar geometry remains.

## D4: Terrain heightmap generated on the GPU
The heightmap (2048² over 40.96 km, 20 m/texel; 1024² on Low) is rendered by a fragment shader in tiles and read back
once for CPU height queries, so the CPU and GPU use identical data. Rendering uses CDLOD with an instanced grid.

## D5: Parallel workstreams (dynamic workflow)
After freezing `src/core/types.ts`, world, art, fx, audio, HUD and UI are built by parallel workers in isolated
worktrees with exclusive path ownership; the orchestrator builds core, flight, weapons, AI and modes, then merges
one stream at a time with the full gate after each merge.
