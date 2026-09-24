// Screenshot tool for the visual verification loop (spec §2.6).
// Usage: node scripts/shot.mjs <url> <out.png> [--width=1920] [--height=1080] [--settle=1500] [--timeout=150000]
// Waits for window.__HARNESS_READY__ === true (or window.__SPLASH_READY__), then settles, then captures.
// Prints every console error/warning and page error; exits 1 if any occurred.
import { chromium } from '@playwright/test';
import { existsSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

const [url, out, ...rest] = process.argv.slice(2);
if (!url || !out) {
  console.error('usage: node scripts/shot.mjs <url> <out.png> [--width=] [--height=] [--settle=] [--timeout=]');
  process.exit(2);
}
const opt = Object.fromEntries(rest.map((a) => a.replace(/^--/, '').split('=')));
const width = Number(opt.width ?? 1920);
const height = Number(opt.height ?? 1080);
const settle = Number(opt.settle ?? 1500);
const timeout = Number(opt.timeout ?? 150000);

const LOCAL = '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const browser = await chromium.launch({
  ...(existsSync(LOCAL) ? { executablePath: LOCAL } : {}),
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'],
});
const page = await browser.newPage({ viewport: { width, height } });
const problems = [];
page.on('console', (m) => {
  if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
});
page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
page.on('requestfailed', (r) => problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`));

const t0 = Date.now();
await page.goto(url, { waitUntil: 'load', timeout });
try {
  await page.waitForFunction(() => window.__HARNESS_READY__ === true || window.__SPLASH_READY__ === true, null, {
    timeout,
    polling: 250,
  });
} catch {
  problems.push('[timeout] ready flag was never set');
}
await page.waitForTimeout(settle);
mkdirSync(dirname(out), { recursive: true });
await page.screenshot({ path: out });
const info = await page.evaluate(() => window.__HARNESS_INFO__ ?? null).catch(() => null);
console.info(`shot: ${out} (${Date.now() - t0} ms)`);
if (info) console.info('info:', JSON.stringify(info));
for (const p of problems) console.error(p);
await browser.close();
process.exit(problems.length ? 1 : 0);
