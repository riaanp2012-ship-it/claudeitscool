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
- Tests: 20 unit tests (flight, guidance, flares, bullets, AI soak at 3 skills, SAM engagement).

## Integrated and published
- All six worker modules merged (world, art, fx, audio, HUD, UI); `src/main.ts` wires them into the game shell.
- Gates green: typecheck, lint, format, guard, 212 unit tests, production build, e2e (boot, free flight,
  instant action with 5 menu→mission→menu cycles and no GPU-resource growth).
- Playable build published: https://claude.ai/artifact/VkqcDTmhPeXpDUxBGfDj7F (build via `npm run build` +
  `node scripts/make-artifact.mjs`).

## In progress (parallel workers)
- World (terrain, water, sky, clouds, vegetation, structures, maps), aircraft art, effects, audio, HUD, menus.
- Reviewer agent auditing the orchestrator code.

## Next
- Merge worker branches one at a time with the full gate; wire `src/main.ts`; enable e2e tests; publish a playable build.

## Known issues
- None open in merged code.

## Performance
- Not measured in the integrated game yet (needs world and art).
