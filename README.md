# claudeitscool

## SPLASH ONE: a build prompt for a 3D fighter jet game

[`FIGHTER_JET_GAME_PROMPT.md`](FIGHTER_JET_GAME_PROMPT.md) is a complete prompt that tells Claude Code how to build a browser-based 3D jet combat game. The game has dogfights against AI pilots, free flight, a training academy, a campaign, several maps, several jets and a full weapons suite.

### What's in the prompt

| Section | Contents |
|---|---|
| §1 Non-negotiables | Locked 60 FPS, no flicker, no console errors, no placeholders, a handmade look |
| §2 Dynamic workflow | A plan → build → verify → critique → re-plan loop. It uses task tracking, memory files that survive between sessions (`CLAUDE.md`, `PROGRESS.md`), parallel subagents with worker and reviewer brief templates, strict automated gates, a screenshot review loop and rules for re-planning |
| §3–4 Tech and architecture | Vite, strict TypeScript and three.js, a fixed-timestep loop with interpolation, content defined as data, and a debug and test API |
| §5 Game design | Modes, 6 fictional jets, weapons with real parameters, the flight model, damage, a three-layer AI with skill levels, 5 maps, 8 training lessons, a 9-mission campaign, cameras, controls and audio |
| §6–7 Art direction | Atmosphere, terrain, water, clouds, effects, and the rules for generating the jets in code |
| §8–9 UI and the anti-AI look | Design tokens, typography, screens, HUD specification, writing style, settings, accessibility, and a list of generic looks to avoid |
| §10 Performance contract | Target hardware, per-frame budgets, techniques and the benchmark |
| §11 **Zero-Defect List** | 157 specific errors that must never appear (flicker, stutter, memory leaks, physics, AI, input, audio, UI, saves, browser issues), each with an ID for QA tracking |
| §12–15 | Tests, phases with gates, Definition of Done, and how to start |

### How to use it

1. Put `FIGHTER_JET_GAME_PROMPT.md` in an empty folder or repo.
2. Open Claude Code there and send:
   > Read FIGHTER_JET_GAME_PROMPT.md from top to bottom, then build the game it describes. Start with Phase 0 and keep going phase by phase until the Definition of Done is met.
3. To continue in a new session:
   > Resume the build. Read CLAUDE.md and docs/PROGRESS.md first, then continue from the next open task.
