import { expect, splashState, test, waitForGame } from './fixtures';

type Api = {
  start(kind: string, opts: Record<string, string>): Promise<void>;
  menu(): void;
  autopilot(): Promise<void>;
  perf(): { geometries: number; textures: number };
};

test.describe.configure({ timeout: 900_000 });

test('free flight on Kessel Strait flies without errors', async ({ page, problems }) => {
  await page.goto('/?autostart=free&map=kessel&aircraft=kestrel');
  await waitForGame(page);
  await page.evaluate(() => (window as unknown as { __SPLASH__: Api }).__SPLASH__.autopilot());
  await page.waitForTimeout(15_000);
  const s = await splashState(page);
  expect(s.state).toBe('game');
  expect(s.player?.alive).toBe(true);
  await page.screenshot({ path: 'artifacts/screens/e2e-freeflight.png' });
  expect(problems).toEqual([]);
});

test('instant action runs, then menu → mission → menu five times without leaking GPU resources', async ({
  page,
  problems,
}) => {
  await page.goto('/?autostart=instant&map=kessel&aircraft=kestrel&enemies=3&allies=1');
  await waitForGame(page);
  await page.evaluate(() => (window as unknown as { __SPLASH__: Api }).__SPLASH__.autopilot());
  await page.waitForTimeout(20_000);
  const s = await splashState(page);
  expect(['game', 'debrief']).toContain(s.state);
  await page.screenshot({ path: 'artifacts/screens/e2e-instant.png' });

  const counts: { geometries: number; textures: number }[] = [];
  for (let i = 0; i < 5; i++) {
    await page.evaluate(() => (window as unknown as { __SPLASH__: Api }).__SPLASH__.menu());
    await page.waitForTimeout(1500);
    counts.push(await page.evaluate(() => (window as unknown as { __SPLASH__: Api }).__SPLASH__.perf()));
    await page.evaluate(() => {
      window.__SPLASH_READY__ = false;
      return (window as unknown as { __SPLASH__: Api }).__SPLASH__.start('instant', {
        map: 'kessel',
        aircraft: 'kestrel',
        enemies: '2',
        allies: '0',
      });
    });
    await waitForGame(page);
    await page.waitForTimeout(4000);
  }
  // After the first cycle the counts at the menu must be stable (ZD-C05).
  const first = counts[1]!;
  const last = counts[counts.length - 1]!;
  expect(last.geometries).toBeLessThanOrEqual(first.geometries + 2);
  expect(last.textures).toBeLessThanOrEqual(first.textures + 2);
  expect(problems).toEqual([]);
});
