import { test, expect } from 'playwright/test';

/*
 * Item 3 — theme toggle behavior.
 * The toggle flips [data-theme], persists to localStorage, survives reload
 * with no flash (the pre-paint init script exists in <head> and applies the
 * stored theme before <body> renders), and is a <button> whose accessible
 * name reflects the state it will switch TO.
 */

test('theme toggle flips [data-theme] and persists to localStorage', async ({ page }) => {
  await page.goto('/');

  const toggle = page.locator('#theme-toggle');
  await expect(toggle).toHaveCount(1);

  // Establish a deterministic starting point.
  await page.evaluate(() => {
    document.documentElement.setAttribute('data-theme', 'light');
    localStorage.setItem('theme', 'light');
  });
  // Re-sync the button's label to the forced starting state.
  await page.reload();
  await expect(toggle).toHaveAttribute('aria-label', /dark mode/i);

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('dark');
  await expect(toggle).toHaveAttribute('aria-label', /light mode/i);

  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe('light');
  await expect(toggle).toHaveAttribute('aria-label', /dark mode/i);
});

test('theme survives reload with the choice reapplied before paint', async ({ page }) => {
  await page.goto('/');
  await page.locator('#theme-toggle').click(); // -> some theme
  const chosen = await page.locator('html').getAttribute('data-theme');
  expect(chosen === 'light' || chosen === 'dark').toBe(true);

  await page.reload();
  // The pre-paint init script must have re-applied the stored theme.
  await expect(page.locator('html')).toHaveAttribute('data-theme', chosen!);
  expect(await page.evaluate(() => localStorage.getItem('theme'))).toBe(chosen);
});

test('pre-paint init script exists in <head> (no flash of wrong theme)', async ({ page }) => {
  const res = await page.goto('/');
  const html = (await res!.text());

  const headEnd = html.indexOf('</head>');
  const bodyStart = html.indexOf('<body');
  const head = html.slice(0, headEnd);

  // An inline script in <head> reads the stored theme and sets the attribute
  // before the body renders.
  expect(head).toMatch(/localStorage\.getItem\(['"]theme['"]\)/);
  expect(head).toMatch(/setAttribute\(['"]data-theme['"]/);
  // Ordering sanity: the head (and thus the init script) precedes <body>.
  expect(headEnd).toBeLessThan(bodyStart);
});

test('toggle is a <button> with a stateful accessible name', async ({ page }) => {
  await page.goto('/');
  const toggle = page.locator('#theme-toggle');
  expect((await toggle.evaluate((el) => el.tagName)).toLowerCase()).toBe('button');
  await expect(toggle).toHaveAttribute('type', 'button');
  // Accessible name is present and describes the action.
  const name = await toggle.getAttribute('aria-label');
  expect(name).toMatch(/switch to (dark|light) mode/i);
});
