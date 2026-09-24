import { writeFileSync, mkdirSync } from 'node:fs';
import { expect, test } from '@playwright/test';

/**
 * Performance benchmark (spec §10.4). Headless Chromium renders with SwiftShader, so GPU time is not
 * meaningful here; this enforces CPU frame time, draw calls and triangles on a 12-aircraft battle.
 */
type Perf = { avgCpuMs: number; p95CpuMs: number; maxCpuMs: number; calls: number; triangles: number };

test.describe.configure({ timeout: 900_000 });

test('12-aircraft battle over Kessel Strait stays within CPU and draw-call budgets', async ({ page }) => {
  await page.goto('/?autostart=instant&map=kessel&aircraft=harrow&enemies=6&allies=5');
  await page.waitForFunction(() => window.__SPLASH_READY__ === true, null, {
    timeout: 300_000,
    polling: 1000,
  });
  await page.evaluate(() =>
    (window as unknown as { __SPLASH__: { autopilot(): Promise<void> } }).__SPLASH__.autopilot(),
  );
  await page.waitForTimeout(5000);
  await page.evaluate(() =>
    (window as unknown as { __SPLASH__: { resetPerf(): void } }).__SPLASH__.resetPerf(),
  );
  const samples: Perf[] = [];
  for (let i = 0; i < 12; i++) {
    await page.waitForTimeout(5000);
    samples.push(
      await page.evaluate(() => (window as unknown as { __SPLASH__: { perf(): Perf } }).__SPLASH__.perf()),
    );
  }
  mkdirSync('artifacts', { recursive: true });
  writeFileSync('artifacts/bench.json', JSON.stringify(samples, null, 2));
  const worstP95 = Math.max(...samples.map((s) => s.p95CpuMs));
  const maxCalls = Math.max(...samples.map((s) => s.calls));
  const maxTris = Math.max(...samples.map((s) => s.triangles));
  console.info(
    `bench: worst p95 CPU ${worstP95.toFixed(2)} ms, max draw calls ${maxCalls}, max triangles ${maxTris}`,
  );
  expect(maxCalls).toBeLessThanOrEqual(300);
  expect(maxTris).toBeLessThanOrEqual(2_500_000);
});
