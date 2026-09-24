# QA report

Status: `open` until verified. Method: automated test name, screenshot review, or manual check.

| ID | Defect that must not exist | Status | Verified by |
|---|---|---|---|
| ZD-A01 | TypeScript errors, implicit `any`, unsafe casts used to silence errors. | open | |
| ZD-A02 | Any `console.error`, `console.warn`, uncaught exception or unhandled promise rejection, at any time, in any mode. E2E tests fail on them. | open | |
| ZD-A03 | 404s, failed requests, CORS errors, runtime CDN fetches. | open | |
| ZD-A04 | three.js deprecation warnings, WebGL errors or warnings (`GL_INVALID_OPERATION`, texture format mismatch, and so on), shader compile warnings. | open | |
| ZD-A05 | TODO, FIXME, stubs, `not implemented`, commented-out code blocks, `console.log`, `debugger` in shipped code. | open | |
| ZD-A06 | Lint errors, blanket `eslint-disable`, `@ts-ignore` or `@ts-expect-error` without a written justification. | open | |
| ZD-A07 | Unexplained production build warnings (chunk size, circular dependencies). | open | |
| ZD-A08 | Debug code, cheat keys or the test API present in the production bundle. | open | |
| ZD-A09 | Magic tuning numbers inline in logic instead of in `src/data`. | open | |
| ZD-B01 | Z-fighting: runway versus terrain, decals, water versus shore, cockpit layers, distant mountains. Prevent it with the depth strategy (§10.3), polygon offset for coplanar details and no coplanar surfaces. | open | |
| ZD-B02 | Shadow acne (striped self-shadowing). | open | |
| ZD-B03 | Peter-panning (floating shadows from over-biasing). | open | |
| ZD-B04 | Shadow shimmer or swimming when the camera moves. Use texel-snapped, stabilized cascades. | open | |
| ZD-B05 | LOD popping on terrain, aircraft or props. Use geomorphing, hysteresis and dithered crossfade. | open | |
| ZD-B06 | Cracks, gaps or T-junction holes between terrain chunks. Use skirts and stitched edges. | open | |
| ZD-B07 | Alpha-sorting flicker on clouds, smoke, canopy glass or particles. Use explicit render order, per-system sorting, premultiplied alpha and `depthWrite: false` on transparent materials. | open | |
| ZD-B08 | Hard lines where particles or clouds intersect geometry. Use soft particles. | open | |
| ZD-B09 | A flat cloud billboard visible when the camera is inside or near a cloud. | open | |
| ZD-B10 | Banding in the sky, fog or dark gradients. Use dithering and half-float targets. | open | |
| ZD-B11 | Washed-out or crushed colors, double gamma, double tone mapping, wrong texture color spaces. | open | |
| ZD-B12 | Bloom blowouts, fireflies or specular sparkle, and NaN or black pixels from shaders. | open | |
| ZD-B13 | Crawling jagged edges on wings, antennas, cables or HUD lines. | open | |
| ZD-B14 | Texture shimmer or moiré on distant terrain and runways. Use mipmaps and anisotropic filtering. | open | |
| ZD-B15 | Stretched textures on cliffs. Use triplanar mapping. | open | |
| ZD-B16 | Obvious texture tiling repetition. | open | |
| ZD-B17 | Fog and terrain color not matching the sky at the horizon. | open | |
| ZD-B18 | A visible world edge, void, or black area under the horizon at high altitude. | open | |
| ZD-B19 | Sun disk, light direction, shadows, specular highlights and lens flare out of alignment. | open | |
| ZD-B20 | Lens flare popping on or off through terrain or aircraft. Fade occlusion over 150 ms. | open | |
| ZD-B21 | White or black flashes on load, screen change, resize or fullscreen toggle. | open | |
| ZD-B22 | A stretched or squashed image after resize. Update camera, composer and render targets in one handler. | open | |
| ZD-B23 | A blurry canvas or HUD on HiDPI screens. | open | |
| ZD-B24 | The camera clipping into terrain, water, buildings or the player's own jet. | open | |
| ZD-B25 | Near-plane clipping of the nose or canopy in chase or cockpit view. | open | |
| ZD-B26 | Inverted normals, missing faces, see-through seams or holes in the jet meshes. | open | |
| ZD-B27 | Magenta, black or missing-texture materials, or default gray meshes. | open | |
| ZD-B28 | Nav and strobe lights blinking in sync on every aircraft. | open | |
| ZD-B29 | Vertex wobble or jitter far from the origin (precision). | open | |
| ZD-B30 | Water tile seams, sparkling aliasing, hard shorelines. | open | |
| ZD-B31 | HUD flicker, number jitter or subpixel shimmer. | open | |
| ZD-B32 | DOM UI flicker or tearing during animations or layout thrash. | open | |
| ZD-B33 | Bloom or heat haze bleeding over the HUD. | open | |
| ZD-B34 | Particles or trails snapping out of existence when pools recycle. | open | |
| ZD-B35 | Motion judder of the jet or camera at a steady 60 FPS, caused by missing interpolation or wrong update order. | open | |
| ZD-B36 | Distant aircraft vanishing: they must stay at least a 2 px dot, as in real life. | open | |
| ZD-C01 | Below 60 FPS on reference hardware at the default preset. | open | |
| ZD-C02 | A hitch the first time an effect, material, weapon or map feature is used (shader compile). Warm everything up while loading. | open | |
| ZD-C03 | Hitches while streaming terrain or uploading textures. | open | |
| ZD-C04 | GC pauses caused by per-frame allocations. | open | |
| ZD-C05 | Memory leaks across restarts or mode switches: geometries, materials, textures, render targets, audio nodes, listeners, workers, timers. | open | |
| ZD-C06 | Unbounded bullets, particles, trails, decals, debris, lights or audio voices. Every one has a hard cap and a pool. | open | |
| ZD-C07 | Draw-call explosions from unbatched or uninstanced repeated objects. | open | |
| ZD-C08 | A spiral of death after a hitch. | open | |
| ZD-C09 | A huge time step after tab switches or breakpoints causing teleports or crashes. | open | |
| ZD-C10 | Game speed tied to the refresh rate. | open | |
| ZD-C11 | Judder from `setTimeout` or `setInterval` loops. | open | |
| ZD-C12 | Main-thread tasks over 8 ms during gameplay. | open | |
| ZD-C13 | Adaptive resolution visibly pumping or oscillating. | open | |
| ZD-C14 | O(n²) collision or AI queries. | open | |
| ZD-C15 | Excessive overdraw from smoke or clouds filling the screen. | open | |
| ZD-C16 | A slow first load or oversized bundle. Code-split menus from gameplay and lazy-load maps. | open | |
| ZD-C17 | Rendering at full 4K device pixel ratio on weak GPUs. | open | |
| ZD-D01 | Gimbal lock or sudden flips near vertical. | open | |
| ZD-D02 | Quaternion drift. | open | |
| ZD-D03 | NaN or Infinity propagation (zero velocity, normalizing a zero vector, `acos` out of range). Use safe math helpers, plus a dev assertion that freezes and reports the first NaN. | open | |
| ZD-D04 | Bullets or missiles tunneling through targets. | open | |
| ZD-D05 | Aircraft passing through terrain at high speed. | open | |
| ZD-D06 | Unphysical flight: infinite climb, no energy loss in turns, full turn rate at stall speed, stalling at 1,000 km/h. | open | |
| ZD-D07 | Missiles orbiting targets forever or turning beyond their G limit. | open | |
| ZD-D08 | Missiles hitting their own launcher. | open | |
| ZD-D09 | Locking on through mountains or outside the seeker gimbal. | open | |
| ZD-D10 | Flares that are 100% or 0% effective regardless of timing and aspect. | open | |
| ZD-D11 | Splash damage passing through terrain. | open | |
| ZD-D12 | Spawning inside terrain, buildings or other aircraft. | open | |
| ZD-D13 | False ground collisions on the runway, or missed collisions when landing gear-up. | open | |
| ZD-D14 | Different results for the same seed (a stray `Math.random` in gameplay). | open | |
| ZD-E01 | Kills counted twice, credited to the wrong player, or assists lost. | open | |
| ZD-E02 | Friendly fire behaving inconsistently with the settings. | open | |
| ZD-E03 | Objectives completing twice, never triggering or triggering out of order. | open | |
| ZD-E04 | Softlocks: no way to finish, fail, retry or exit a mission or lesson. | open | |
| ZD-E05 | Pause not pausing everything: audio, timers, AI, particles, missiles, tweens. | open | |
| ZD-E06 | Double-clicking Start launching two sessions, or duplicated listeners. | open | |
| ZD-E07 | Restart leaving old entities, sounds or timers alive. | open | |
| ZD-E08 | Out of bounds with no warning, or instant death. | open | |
| ZD-E09 | Taking off or landing through buildings, getting stuck on the ground, or a gear-up landing not handled. | open | |
| ZD-E10 | Ammunition counts out of sync with the ordnance visible on the pylons. | open | |
| ZD-E11 | Respawning into gunfire with no protection window. Give 3 s of protection that ends when the player fires. | open | |
| ZD-E12 | Displayed values showing NaN, `undefined`, negative numbers or unformatted numbers. | open | |
| ZD-E13 | Difficulty or rule settings that change nothing. | open | |
| ZD-E14 | Mission end or debrief firing twice, or never firing. | open | |
| ZD-F01 | AI flying into terrain or water (target crash rate under 1% in the soak test). | open | |
| ZD-F02 | AI mid-air collisions in furballs. | open | |
| ZD-F03 | Endless circling stalemates. | open | |
| ZD-F04 | AI never firing missiles, or dumping all of them at once. | open | |
| ZD-F05 | AI ignoring incoming missiles, or reacting with superhuman instant precision. | open | |
| ZD-F06 | AI leaving the combat area. | open | |
| ZD-F07 | Wingmen who are useless, or who steal every kill. | open | |
| ZD-F08 | Oscillating or jittery AI control inputs. | open | |
| ZD-F09 | All AI pilots flying identically. | open | |
| ZD-F10 | AI stuck in stalls or spins. | open | |
| ZD-F11 | AI cheating: seeing through terrain, perfect aim, physics the player doesn't have. | open | |
| ZD-G01 | Camera jitter from the wrong update order. | open | |
| ZD-G02 | Nauseating snaps when switching cameras. | open | |
| ZD-G03 | Harsh per-frame random shake. | open | |
| ZD-G04 | Losing orientation with no way to find the target (padlock and target camera required). | open | |
| ZD-G05 | Horizon "swimming" from badly tuned roll lag. | open | |
| ZD-G06 | Fisheye distortion from FOV effects. | open | |
| ZD-H01 | Stuck keys or buttons after Alt-Tab or focus loss. Clear all input on `blur` and `visibilitychange`. | open | |
| ZD-H02 | Browser shortcuts hijacking play: Space scrolling the page, Tab moving focus, F1, F3, F5, Backspace. Call `preventDefault` for bound keys during play, and never bind Ctrl or Meta combinations. | open | |
| ZD-H03 | Broken bindings on AZERTY or QWERTZ keyboards. Bind by `code` and show labels from the actual layout. | open | |
| ZD-H04 | Pointer lock errors: an unhandled rejected promise, relocking too soon after Esc (respect the roughly 1 s cooldown), or losing lock silently. Show a "Click to resume" overlay. | open | |
| ZD-H05 | Mouse sensitivity that varies with frame rate. | open | |
| ZD-H06 | Gamepad drift, no deadzone, wrong mapping, or a crash on disconnect (auto-pause instead). | open | |
| ZD-H07 | Context menu, text selection or drag ghosting on the game canvas. | open | |
| ZD-H08 | Menus that can't be navigated with keyboard or gamepad, or invisible focus. | open | |
| ZD-H09 | Binding conflicts accepted silently. | open | |
| ZD-H10 | Input leaking between contexts, such as the click on "Resume" also firing the gun. | open | |
| ZD-I01 | No sound because the `AudioContext` was never resumed. Resume it on the title-screen key press. | open | |
| ZD-I02 | Clicks or pops when sounds start or stop. Use gain ramps of at least 5 ms. | open | |
| ZD-I03 | Clipping when many explosions play at once. Use a compressor, a limiter and voice caps. | open | |
| ZD-I04 | Loops continuing after pause, restart or returning to the menu. | open | |
| ZD-I05 | No distance attenuation or occlusion. | open | |
| ZD-I06 | Flybys with no doppler. | open | |
| ZD-I07 | Audio playing while the tab is hidden, when the player has muted it for that case. | open | |
| ZD-I08 | Repetitive or too-loud UI sounds. | open | |
| ZD-I09 | Volume sliders that are non-linear or ineffective. Map them in dB. | open | |
| ZD-J01 | Text overlapping, clipping or overflowing at any supported resolution (1280×720 to 3840×2160, aspect ratios 4:3 to 32:9) or UI scale. | open | |
| ZD-J02 | HUD stretched on ultrawide screens or outside the safe area. | open | |
| ZD-J03 | Placeholder text: lorem ipsum, TODO, "Coming soon", "Button", `undefined`, `NaN`, `[object Object]`. | open | |
| ZD-J04 | Missing hover, focus, active or disabled states, or disabled items with no explanation. | open | |
| ZD-J05 | Inconsistent spacing, type sizes, corner radii or icon styles. Tokens only. | open | |
| ZD-J06 | Font flashes (FOUT or FOIT). | open | |
| ZD-J07 | Numbers changing width as they update (no tabular figures). | open | |
| ZD-J08 | Low-contrast text, or a HUD that's unreadable against bright sky or snow. | open | |
| ZD-J09 | A loading bar that lies: stuck at 99%, or driven by a fake timer. | open | |
| ZD-J10 | Settings that don't apply, don't persist, or silently need a reload. | open | |
| ZD-J11 | Dead-end screens or inconsistent back behavior. | open | |
| ZD-J12 | Notifications or toasts stacking without limit. | open | |
| ZD-J13 | A pause-menu flash or flicker when it opens. | open | |
| ZD-J14 | Tooltips running off the screen. | open | |
| ZD-J15 | Modals that can open twice. | open | |
| ZD-J16 | Kill feed, objectives or subtitles overflowing their areas. | open | |
| ZD-K01 | A crash on corrupt or old saved data. Validate, migrate, fall back to defaults and show a non-blocking notice. | open | |
| ZD-K02 | Progress lost on reload. Save on meaningful changes (debounced) and on `pagehide`. | open | |
| ZD-K03 | A crash when storage is unavailable (private mode). Fall back to memory. | open | |
| ZD-K04 | Two open tabs corrupting each other's saves. | open | |
| ZD-L01 | A blank page when WebGL2 is unavailable. Show a clear full-screen message instead. | open | |
| ZD-L02 | A frozen or black screen after WebGL context loss. Handle lost and restored events, rebuild resources and resume. | open | |
| ZD-L03 | Fullscreen requests failing silently, or exiting fullscreen breaking pointer lock state. | open | |
| ZD-L04 | A broken experience on touch-only devices. Show a clear "desktop and controller required" screen. | open | |
| ZD-L05 | Incorrect behavior at 120, 144 or 240 Hz. | open | |
| ZD-L06 | Browser-specific breakage in Chrome, Edge, Firefox or Safari. | open | |
| ZD-L07 | Layout breaking at 80 to 150% browser zoom. | open | |
| ZD-L08 | Leaving mid-mission with no warning when progress would be lost. | open | |
| ZD-M01 | Any item on the forbidden list in §9 is present. | open | |
| ZD-M02 | A screenshot fails the store-page test in §9. | open | |
| ZD-M03 | Copy contains hype words, exclamation marks in menus, emojis or generic filler. | open | |
