import { expect, splashState, test } from './fixtures';

test('boots to the title, then the main menu on a key press', async ({ page, problems }) => {
  await page.goto('/');
  await page.waitForFunction(() => '__SPLASH__' in window, null, { timeout: 60_000 });
  await expect.poll(async () => (await splashState(page)).state, { timeout: 30_000 }).toBe('title');
  await page.waitForTimeout(800);
  await page.keyboard.press('Enter');
  await expect.poll(async () => (await splashState(page)).state, { timeout: 10_000 }).toBe('menu');
  await expect(page.getByText('INSTANT ACTION', { exact: false }).first()).toBeVisible();
  await page.screenshot({ path: 'artifacts/screens/e2e-menu.png' });
  expect(problems).toEqual([]);
});
