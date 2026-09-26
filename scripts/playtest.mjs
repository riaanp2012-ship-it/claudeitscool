// Play-test capture for the visual verification loop: starts a session through the test API, lets the
// autopilot fly, and saves a screenshot series.
// Usage: node scripts/playtest.mjs <baseUrl> <outPrefix> [--mode=instant|free] [--map=kessel] [--aircraft=kestrel]
//        [--shots=3] [--gap=8000] [--preset=low|medium] [--width=1280] [--height=720] [--camera=chase|cockpit]
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [base, prefix, ...rest] = process.argv.slice(2);
if (!base || !prefix) {
  console.error(
    'usage: node scripts/playtest.mjs <baseUrl> <outPrefix> [--mode=] [--map=] [--shots=] [--gap=]',
  );
  process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const width = Number(opt.width ?? 1280);
const height = Number(opt.height ?? 720);
const shots = Number(opt.shots ?? 3);
const gap = Number(opt.gap ?? 8000);
const preset = opt.preset ?? 'low';

const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(existsSync(LOCAL) ? { executablePath: LOCAL } : {}),
  args: [
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--ignore-gpu-blocklist',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
await page.addInitScript((p) => {
  const low = {
    preset: 'low',
    renderScale: 1,
    adaptive: false,
    shadows: 'off',
    clouds: 'low',
    terrain: 'low',
    vegetation: 0.3,
    effects: 'low',
    antialias: false,
    bloom: true,
  };
  const med = { preset: 'medium', renderScale: 1, adaptive: false };
  localStorage.setItem('splash1.settings', JSON.stringify({ graphics: p === 'low' ? low : med }));
}, preset);

await page.goto(base, { waitUntil: 'load', timeout: 120000 });
await page.waitForFunction(() => typeof window.__SPLASH__ !== 'undefined', null, { timeout: 120000 });
const mode = opt.mode ?? 'instant';
const start = {
  map: opt.map ?? 'kessel',
  aircraft: opt.aircraft ?? 'kestrel',
  enemies: opt.enemies ?? '4',
  allies: opt.allies ?? '1',
};
await page.evaluate(([m, o]) => window.__SPLASH__.start(m, o), [mode, start]);
await page.waitForFunction(() => window.__SPLASH__.state().state === 'game', null, {
  timeout: 300000,
  polling: 500,
});
if (opt.autopilot !== 'off') await page.evaluate(() => window.__SPLASH__.autopilot());
if (opt.camera === 'cockpit') await page.keyboard.press('KeyV');
for (let i = 0; i < shots; i++) {
  await page.waitForTimeout(gap);
  const out = `${prefix}-${i + 1}.png`;
  mkdirSync(dirname(out), { recursive: true });
  await page.screenshot({ path: out });
  const s = await page.evaluate(() => window.__SPLASH__.state());
  console.log(`shot ${out} ${JSON.stringify(s)}`);
}
for (const p of problems) console.log(p);
await browser.close();
process.exit(problems.length ? 1 : 0);
