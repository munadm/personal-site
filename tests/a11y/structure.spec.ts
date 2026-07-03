import { test, expect } from 'playwright/test';
import { ROUTES, routeId } from './_shared';

/*
 * Item 9 — heading & landmark structure.
 * Every route:
 *   - exactly one <h1>;
 *   - heading levels never skip DOWN by more than one (h2 -> h4 is a defect);
 *   - exactly one main, one banner (header), one contentinfo (footer).
 */

for (const route of ROUTES) {
  test(`structure: ${routeId(route)} has exactly one h1`, async ({ page }) => {
    await page.goto(route);
    await expect(page.locator('h1')).toHaveCount(1);
  });

  test(`structure: ${routeId(route)} heading levels never skip down`, async ({ page }) => {
    await page.goto(route);
    const levels = await page.evaluate(() =>
      Array.from(document.querySelectorAll('h1,h2,h3,h4,h5,h6')).map((h) =>
        Number(h.tagName.slice(1)),
      ),
    );
    expect(levels[0], 'first heading should be the h1').toBe(1);
    for (let i = 1; i < levels.length; i++) {
      const jump = levels[i] - levels[i - 1];
      expect(
        jump,
        `heading ${i} (h${levels[i]}) skips down more than one level from h${levels[i - 1]}`,
      ).toBeLessThanOrEqual(1);
    }
  });

  test(`structure: ${routeId(route)} has one main/banner/contentinfo landmark`, async ({ page }) => {
    await page.goto(route);
    // <main> maps to role=main, <header> (top-level) to banner, <footer> to contentinfo.
    await expect(page.getByRole('main')).toHaveCount(1);
    await expect(page.getByRole('banner')).toHaveCount(1);
    await expect(page.getByRole('contentinfo')).toHaveCount(1);
  });
}
