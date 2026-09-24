# Plan

## Phases
0. Scaffold, tooling, contracts, docs. **(done when this file is committed)**
1. Engine core (orchestrator) ‖ parallel: world, art, fx, audio, HUD, UI workers.
2. Vertical slice: Free Flight on Kessel Strait (integrate world + art + HUD + audio).
3. Combat: guns, missiles, countermeasures, damage (integrate fx).
4. AI and Instant Action, debrief. **First playable link published here.**
5. Content: Mesa Roja, Norrdal Fjords, remaining jets, training lessons.
6. Campaign, survival, progression, hangar.
7. Polish, presets, adaptive resolution, benchmark mode.
8. Zero-defect audit with reviewer agents, docs, ship.

## Risk register
| Risk | Mitigation |
|---|---|
| GPU cost of terrain + clouds on integrated graphics | CDLOD with per-preset grid, impostor clouds, adaptive resolution, bench gate |
| Procedural jets looking amateur | Lofted cross-sections, airfoil wings, procedural livery shader with panel lines and weathering, screenshot critique loop |
| AI quality (crashing, circling, unfair) | Same flight model as the player, terrain look-ahead override, stalemate detector, soak test with crash-rate threshold |
| Integration drift between parallel workers | Frozen contracts in `src/core/types.ts`, exclusive path ownership, merge one stream at a time with full gate |
| Headless tests can't measure GPU FPS | Enforce CPU frame time, draw calls, triangles and heap in CI; in-game benchmark for real GPUs |
| Scope | Tier ordering; nothing half-built reachable from the UI |
