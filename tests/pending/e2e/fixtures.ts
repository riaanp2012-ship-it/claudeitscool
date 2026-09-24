import { test as base, expect, type Page } from '@playwright/test';

/**
 * Shared e2e fixture: any console error/warning, page error or failed request fails the test (ZD-A02, A03).
 */
export const test = base.extend<{ problems: string[] }>({
  problems: async ({ page }, use) => {
    const problems: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'error' || m.type() === 'warning') problems.push(`[console.${m.type()}] ${m.text()}`);
    });
    page.on('pageerror', (e) => problems.push(`[pageerror] ${e.message}`));
    page.on('requestfailed', (r) =>
      problems.push(`[requestfailed] ${r.url()} ${r.failure()?.errorText ?? ''}`),
    );
    await use(problems);
    expect(problems, problems.join('\n')).toEqual([]);
  },
});

export { expect };

export interface SplashState {
  state: string;
  aircraft: number;
  alive: number;
  kills: number;
  time: number;
  player: { alive: boolean; altitude: number; speed: number } | null;
}

export async function splashState(page: Page): Promise<SplashState> {
  return page.evaluate(() =>
    (window as unknown as { __SPLASH__: { state(): SplashState } }).__SPLASH__.state(),
  );
}

export async function waitForGame(page: Page, timeout = 240_000): Promise<void> {
  await page.waitForFunction(() => window.__SPLASH_READY__ === true, null, { timeout, polling: 500 });
}
