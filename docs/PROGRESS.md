# Progress

## Done (orchestrator)
- Phase 0: scaffold, strict tooling, guard, screenshot tool, recurring QA sweep, frozen contracts, shared atmosphere.
- Flight model with calibrated wave drag (all six jets within 5% of published top speed), G/AoA limiters,
  stall, ground handling; instructor autopilot (mouse aim and AI virtual stick).
- Combat: swept bullets, PN missiles (≥ 95% hits on non-maneuvering targets), flares/chaff with timing,
  notching, rockets, laser-guided bombs, lock-on, RWR; ground units (SAM, AAA, radar, ships, buildings).
- AI: utility pilots with three skill levels, missile defense, guns defense, extend on stalemate,
  terrain look-ahead, fairness limits, formation and wingman orders, passive escorts.
- Modes: Free Flight (ring course, drones), Instant Action, Training (8 lessons), Campaign (9 missions), Survival.
- Game shell: title → menus → loading (shader warmup) → game ⇄ pause → debrief; profile, XP, ranks, medals;
  hangar menu scene; perf overlay (F3); adaptive resolution; debug API for tests.
- Tests: flight, guidance, flares, bullets, AI soak at 3 skills, SAM engagement, keyboard steering.
- Controls: WASD turns and climbs (A/D bank-to-turn through the instructor, W/S pitch), Q/E roll; menu-held
  buttons are ignored in flight until released.

## Integrated and published
- All six worker modules merged (world, art, fx, audio, HUD, UI); `src/main.ts` wires them into the game shell.
- Gates green: typecheck, lint, format, guard, unit tests (27 files), production build, e2e (boot, free flight,
  instant action with 5 menu→mission→menu cycles and no GPU-resource growth).
- Playable build published: https://claude.ai/artifact/VkqcDTmhPeXpDUxBGfDj7F (build via `npm run build` +
  `node scripts/make-artifact.mjs`).

- Effects, audio, HUD and menus are final. All six jets are modeled (silhouette pass merged).
- World: Kessel Strait complete (GPU heightmap, CDLOD terrain, sky, water, clouds with shadows, chalk cliffs,
  tree stands); NaN in terrain skirts fixed.

## In progress (parallel workers)
- World worker: Mesa Roja, then Norrdal Fjords (campaign missions 3–6 unlock with them), then Typhoon Atoll and Varen.
- Art worker: procedural ground-unit models to replace the interim ones in `src/combat/groundModels.ts`.

## Next
- Wire the ground-unit models into `Session.spawnGround`; merge each map as it lands; republish after each merge.
- Play-test captures: `node scripts/playtest.mjs http://localhost:<port>/ artifacts/screens/pt` (Low preset,
  autopilot, screenshot series).

## Known issues
- None open in merged code.

## Performance
- Not measured in the integrated game yet (needs world and art).
